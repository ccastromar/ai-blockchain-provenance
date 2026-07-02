package worker

import (
	"context"
	"errors"
	"testing"

	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/metrics"
	"event-ingestor/internal/redisstream"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// fakeWriter is an in-memory Writer double: no MongoDB required.
type fakeWriter struct {
	appendBlock hashchain.Block
	appendErr   error
	appendCalls []events.CanonicalEvent

	recordFailureErr   error
	recordFailureCalls []string

	markDuplicateErr   error
	markDuplicateCalls []events.CanonicalEvent
}

func (f *fakeWriter) EnsureIndexes(context.Context) error { return nil }

func (f *fakeWriter) AppendEvent(_ context.Context, event events.CanonicalEvent) (hashchain.Block, error) {
	f.appendCalls = append(f.appendCalls, event)
	if f.appendErr != nil {
		return hashchain.Block{}, f.appendErr
	}
	return f.appendBlock, nil
}

func (f *fakeWriter) RecordFailure(_ context.Context, sourceStreamID string, _ map[string]string, _ error) error {
	f.recordFailureCalls = append(f.recordFailureCalls, sourceStreamID)
	return f.recordFailureErr
}

func (f *fakeWriter) MarkDuplicate(_ context.Context, event events.CanonicalEvent) error {
	f.markDuplicateCalls = append(f.markDuplicateCalls, event)
	return f.markDuplicateErr
}

// autoClaimPage is one canned XAUTOCLAIM reply for fakeStream to hand back in sequence.
type autoClaimPage struct {
	cursor   string
	messages []redisstream.Message
	err      error
}

// fakeStream is an in-memory StreamClient double: no Redis required.
type fakeStream struct {
	ackCalls []string
	xAckErr  error

	dlqAdds []map[string]string
	xAddErr error

	autoClaimPages []autoClaimPage
	autoClaimCalls int
}

func (f *fakeStream) XGroupCreateMkStream(context.Context, string, string) error { return nil }

func (f *fakeStream) XReadGroup(context.Context, string, string, string, int64, int64) ([]redisstream.Message, error) {
	return nil, nil
}

func (f *fakeStream) XAck(_ context.Context, _ string, _ string, id string) error {
	f.ackCalls = append(f.ackCalls, id)
	return f.xAckErr
}

func (f *fakeStream) XAdd(_ context.Context, _ string, _ int64, fields map[string]string) (string, error) {
	f.dlqAdds = append(f.dlqAdds, fields)
	if f.xAddErr != nil {
		return "", f.xAddErr
	}
	return "dlq-1", nil
}

func (f *fakeStream) XAutoClaim(context.Context, string, string, string, int64, string, int64) (string, []redisstream.Message, error) {
	if f.autoClaimCalls >= len(f.autoClaimPages) {
		return "0-0", nil, nil
	}
	page := f.autoClaimPages[f.autoClaimCalls]
	f.autoClaimCalls++
	return page.cursor, page.messages, page.err
}

func newTestWorker(stream *fakeStream, writer *fakeWriter) Worker {
	return New(stream, writer, config.Config{
		RedisStream:      "ernest:events:incoming",
		RedisGroup:       "provenance-writers",
		RedisConsumer:    "test-consumer",
		RedisDLQStream:   "ernest:events:deadletter",
		RedisMaxLen:      1000,
		WorkerBatchCount: 10,
	})
}

func rawEventMessage(id string, source string) redisstream.Message {
	return redisstream.Message{
		ID: id,
		Fields: map[string]string{
			"source":        source,
			"eventType":     "model.registered",
			"sourceEventId": id,
			"rawEventHash":  "hash-" + id,
			"payload":       `{"modelId":"credit-risk"}`,
		},
	}
}

func TestProcessAppendsNewEvent(t *testing.T) {
	writer := &fakeWriter{appendBlock: hashchain.Block{Index: 7}}
	w := newTestWorker(&fakeStream{}, writer)

	before := testutil.ToFloat64(metrics.BlocksAppended.WithLabelValues("sagemaker"))

	if err := w.process(context.Background(), rawEventMessage("1-0", "sagemaker")); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(writer.appendCalls) != 1 {
		t.Fatalf("expected AppendEvent to be called once, got %d", len(writer.appendCalls))
	}
	if got := testutil.ToFloat64(metrics.BlocksAppended.WithLabelValues("sagemaker")) - before; got != 1 {
		t.Fatalf("expected blocks_appended to increase by 1, got %v", got)
	}
}

func TestProcessSkipsDuplicateAndMarksIt(t *testing.T) {
	writer := &fakeWriter{appendErr: hashchain.ErrDuplicateEvent}
	w := newTestWorker(&fakeStream{}, writer)

	before := testutil.ToFloat64(metrics.EventsDuplicate.WithLabelValues("huggingface"))

	err := w.process(context.Background(), rawEventMessage("1-0", "huggingface"))
	if err != nil {
		t.Fatalf("expected duplicate to be swallowed (nil error), got %v", err)
	}
	if len(writer.markDuplicateCalls) != 1 {
		t.Fatalf("expected MarkDuplicate to be called once, got %d", len(writer.markDuplicateCalls))
	}
	if got := testutil.ToFloat64(metrics.EventsDuplicate.WithLabelValues("huggingface")) - before; got != 1 {
		t.Fatalf("expected events_duplicate to increase by 1, got %v", got)
	}
}

func TestProcessPropagatesNonDuplicateAppendError(t *testing.T) {
	boom := errors.New("mongo write failed")
	writer := &fakeWriter{appendErr: boom}
	w := newTestWorker(&fakeStream{}, writer)

	err := w.process(context.Background(), rawEventMessage("1-0", "databricks"))
	if !errors.Is(err, boom) {
		t.Fatalf("expected append error to propagate, got %v", err)
	}
	if len(writer.markDuplicateCalls) != 0 {
		t.Fatal("expected MarkDuplicate not to be called for a non-duplicate error")
	}
}

func TestHandleMessageAcksOnSuccessWithoutDeadLettering(t *testing.T) {
	stream := &fakeStream{}
	writer := &fakeWriter{appendBlock: hashchain.Block{Index: 1}}
	w := newTestWorker(stream, writer)

	w.handleMessage(context.Background(), rawEventMessage("1-0", "sagemaker"))

	if len(stream.ackCalls) != 1 || stream.ackCalls[0] != "1-0" {
		t.Fatalf("expected message to be acked once, got %v", stream.ackCalls)
	}
	if len(stream.dlqAdds) != 0 {
		t.Fatal("expected no DLQ writes on success")
	}
	if len(writer.recordFailureCalls) != 0 {
		t.Fatal("expected no RecordFailure calls on success")
	}
}

func TestHandleMessageDeadLettersRecordsFailureAndStillAcks(t *testing.T) {
	stream := &fakeStream{}
	writer := &fakeWriter{appendErr: errors.New("mongo down")}
	w := newTestWorker(stream, writer)

	before := testutil.ToFloat64(metrics.EventsProcessingFailed.WithLabelValues("azureml"))

	w.handleMessage(context.Background(), rawEventMessage("2-0", "azureml"))

	if len(writer.recordFailureCalls) != 1 || writer.recordFailureCalls[0] != "2-0" {
		t.Fatalf("expected RecordFailure to be called once with the message ID, got %v", writer.recordFailureCalls)
	}
	if len(stream.dlqAdds) != 1 || stream.dlqAdds[0]["sourceStreamId"] != "2-0" {
		t.Fatalf("expected one DLQ write for the failed message, got %v", stream.dlqAdds)
	}
	// A failed message that is never acked would be redelivered forever (poison pill).
	if len(stream.ackCalls) != 1 || stream.ackCalls[0] != "2-0" {
		t.Fatalf("expected the failed message to still be acked exactly once, got %v", stream.ackCalls)
	}
	if got := testutil.ToFloat64(metrics.EventsProcessingFailed.WithLabelValues("azureml")) - before; got != 1 {
		t.Fatalf("expected events_processing_failed to increase by 1, got %v", got)
	}
}

func TestReclaimStaleProcessesAcrossPagesAndStopsOnZeroCursor(t *testing.T) {
	stream := &fakeStream{
		autoClaimPages: []autoClaimPage{
			{cursor: "5-0", messages: []redisstream.Message{rawEventMessage("1-0", "sagemaker")}},
			{cursor: "0-0", messages: []redisstream.Message{rawEventMessage("2-0", "sagemaker")}},
		},
	}
	writer := &fakeWriter{appendBlock: hashchain.Block{Index: 1}}
	w := newTestWorker(stream, writer)

	before := testutil.ToFloat64(metrics.EventsReclaimed)

	if err := w.reclaimStale(context.Background()); err != nil {
		t.Fatalf("reclaimStale: %v", err)
	}

	if stream.autoClaimCalls != 2 {
		t.Fatalf("expected XAutoClaim to be paginated exactly twice, got %d calls", stream.autoClaimCalls)
	}
	if len(stream.ackCalls) != 2 {
		t.Fatalf("expected both reclaimed messages to be processed and acked, got %v", stream.ackCalls)
	}
	if got := testutil.ToFloat64(metrics.EventsReclaimed) - before; got != 2 {
		t.Fatalf("expected events_reclaimed to increase by 2, got %v", got)
	}
}

func TestReclaimStaleStopsOnEmptyPage(t *testing.T) {
	stream := &fakeStream{
		autoClaimPages: []autoClaimPage{
			{cursor: "5-0", messages: nil},
			{cursor: "9-0", messages: []redisstream.Message{rawEventMessage("should-not-run", "sagemaker")}},
		},
	}
	w := newTestWorker(stream, &fakeWriter{})

	if err := w.reclaimStale(context.Background()); err != nil {
		t.Fatalf("reclaimStale: %v", err)
	}
	if stream.autoClaimCalls != 1 {
		t.Fatalf("expected reclaimStale to stop after an empty page, got %d calls", stream.autoClaimCalls)
	}
}

func TestReclaimStaleStopsWhenCursorRepeats(t *testing.T) {
	// A cursor that repeats without ever reaching "0-0" would loop forever without this
	// guard: len(messages) == 0 alone wouldn't catch it since these pages are non-empty.
	stream := &fakeStream{
		autoClaimPages: []autoClaimPage{
			{cursor: "5-0", messages: []redisstream.Message{rawEventMessage("1-0", "sagemaker")}},
			{cursor: "5-0", messages: []redisstream.Message{rawEventMessage("2-0", "sagemaker")}},
		},
	}
	writer := &fakeWriter{appendBlock: hashchain.Block{Index: 1}}
	w := newTestWorker(stream, writer)

	if err := w.reclaimStale(context.Background()); err != nil {
		t.Fatalf("reclaimStale: %v", err)
	}
	if stream.autoClaimCalls != 2 {
		t.Fatalf("expected reclaimStale to stop once the cursor repeats (after 2 calls), got %d calls", stream.autoClaimCalls)
	}
}

func TestReclaimStalePropagatesXAutoClaimError(t *testing.T) {
	boom := errors.New("redis unreachable")
	stream := &fakeStream{autoClaimPages: []autoClaimPage{{err: boom}}}
	w := newTestWorker(stream, &fakeWriter{})

	if err := w.reclaimStale(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("expected XAutoClaim error to propagate, got %v", err)
	}
}
