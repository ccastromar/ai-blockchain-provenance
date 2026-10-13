package worker

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/metrics"
	"event-ingestor/internal/redisstream"
)

// StreamClient is the subset of redisstream.Client the worker depends on. It exists so
// tests can exercise Worker's processing logic (dedup, DLQ, reclaim) against a fake
// without a real Redis, and to keep the worker package from depending directly on a
// concrete transport type.
type StreamClient interface {
	XGroupCreateMkStream(ctx context.Context, stream string, group string) error
	XReadGroup(ctx context.Context, group string, consumer string, stream string, count int64, blockMS int64) ([]redisstream.Message, error)
	XAck(ctx context.Context, stream string, group string, id string) error
	XAdd(ctx context.Context, stream string, maxLen int64, fields map[string]string) (string, error)
	XAutoClaim(ctx context.Context, stream string, group string, consumer string, minIdleMS int64, start string, count int64) (string, []redisstream.Message, error)
}

// Writer is the subset of hashchain.MongoWriter the worker depends on, for the same
// testability reason as StreamClient.
type Writer interface {
	EnsureIndexes(ctx context.Context) error
	AppendEvent(ctx context.Context, event events.CanonicalEvent) (hashchain.Block, error)
	RecordFailure(ctx context.Context, sourceStreamID string, fields map[string]string, processErr error) error
	MarkDuplicate(ctx context.Context, event events.CanonicalEvent) error
}

// BatchWriter is implemented by writers that record a whole read in a few round trips
// (ADR-004 mode); RecordsEvents reports whether that mode is on. Per-event outcomes are the
// same as AppendEvent's.
type BatchWriter interface {
	RecordsEvents() bool
	RecordEvents(ctx context.Context, batch []events.CanonicalEvent) []error
}

// multiAcker acknowledges several entries with one XACK (optional on StreamClient).
type multiAcker interface {
	XAckMany(ctx context.Context, stream string, group string, ids []string) error
}

type Worker struct {
	stream StreamClient
	writer Writer
	cfg    config.Config
}

func New(stream StreamClient, writer Writer, cfg config.Config) Worker {
	return Worker{stream: stream, writer: writer, cfg: cfg}
}

func (w Worker) Run(ctx context.Context) error {
	if err := w.stream.XGroupCreateMkStream(ctx, w.cfg.RedisStream, w.cfg.RedisGroup); err != nil {
		return err
	}
	if err := w.stream.XGroupCreateMkStream(ctx, w.cfg.RedisRejectedStream, w.cfg.RedisGroup); err != nil {
		return err
	}
	if err := w.writer.EnsureIndexes(ctx); err != nil {
		return err
	}

	log.Printf("worker reading stream=%s rejectedStream=%s group=%s consumer=%s", w.cfg.RedisStream, w.cfg.RedisRejectedStream, w.cfg.RedisGroup, w.cfg.RedisConsumer)
	reclaimInterval := time.Duration(w.cfg.WorkerReclaimIntervalMS) * time.Millisecond
	lastReclaim := time.Now()
	trimInterval := time.Duration(w.cfg.WorkerTrimIntervalMS) * time.Millisecond
	lastTrim := time.Now()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := w.processRejected(ctx); err != nil {
			log.Printf("rejected event processing failed: %v", err)
		}

		if reclaimInterval > 0 && time.Since(lastReclaim) >= reclaimInterval {
			if err := w.reclaimStale(ctx); err != nil {
				log.Printf("reclaim stale pending messages failed: %v", err)
			}
			lastReclaim = time.Now()
		}

		if trimInterval > 0 && time.Since(lastTrim) >= trimInterval {
			w.trimAcknowledged(ctx)
			lastTrim = time.Now()
		}

		messages, err := w.stream.XReadGroup(ctx, w.cfg.RedisGroup, w.cfg.RedisConsumer, w.cfg.RedisStream, w.cfg.WorkerBatchCount, w.cfg.WorkerBlockMS)
		if err != nil {
			log.Printf("redis read failed: %v", err)
			time.Sleep(time.Second)
			continue
		}
		w.handleMessages(ctx, messages)
	}
}

// handleMessages processes one read. In ADR-004 mode the whole read is recorded together —
// the same per-event outcome (recorded, duplicate, or failed to the DLQ) as handleMessage,
// with a few round trips per read instead of several per event, and one ack.
func (w Worker) handleMessages(ctx context.Context, messages []redisstream.Message) {
	bw, ok := w.writer.(BatchWriter)
	if !ok || !bw.RecordsEvents() || len(messages) < 2 {
		for _, message := range messages {
			w.handleMessage(ctx, message)
		}
		return
	}
	failures := map[int]error{}
	batch := make([]events.CanonicalEvent, 0, len(messages))
	positions := make([]int, 0, len(messages))
	for i, message := range messages {
		event, err := parseMessage(message)
		if err != nil {
			failures[i] = err
			continue
		}
		batch = append(batch, events.Normalize(event))
		positions = append(positions, i)
	}
	recorded, duplicates := 0, 0
	for j, err := range bw.RecordEvents(ctx, batch) {
		event := batch[j]
		switch {
		case err == nil:
			recorded++
			metrics.EventsRecorded.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
		case errors.Is(err, hashchain.ErrDuplicateEvent):
			duplicates++
			if markErr := w.writer.MarkDuplicate(ctx, event); markErr != nil {
				log.Printf("mark duplicate %s failed: %v", event.SourceEventID, markErr)
			}
			metrics.EventsDuplicate.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
		default:
			failures[positions[j]] = err
		}
	}
	for i, err := range failures {
		w.fail(ctx, messages[i], err)
	}
	w.ackAll(ctx, messages)
	log.Printf("recorded %d external events (pending chaining), %d duplicates, %d failed", recorded, duplicates, len(failures))
}

func (w Worker) ackAll(ctx context.Context, messages []redisstream.Message) {
	ids := make([]string, len(messages))
	for i, message := range messages {
		ids[i] = message.ID
	}
	if acker, ok := w.stream.(multiAcker); ok {
		if err := acker.XAckMany(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, ids); err != nil {
			log.Printf("ack of %d messages failed: %v", len(ids), err)
		}
		return
	}
	for _, id := range ids {
		if err := w.stream.XAck(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, id); err != nil {
			log.Printf("ack %s failed: %v", id, err)
		}
	}
}

// trimmer is implemented by the Redis client; kept optional so test doubles of
// StreamClient need not implement it.
type trimmer interface {
	TrimAcknowledged(ctx context.Context, stream string, group string) (int64, error)
}

// trimAcknowledged keeps the incoming and rejected streams bounded by removing only what
// the group has processed. Producers no longer trim (MAXLEN dropped unprocessed events).
func (w Worker) trimAcknowledged(ctx context.Context) {
	t, ok := w.stream.(trimmer)
	if !ok {
		return
	}
	for _, stream := range []string{w.cfg.RedisStream, w.cfg.RedisRejectedStream} {
		if _, err := t.TrimAcknowledged(ctx, stream, w.cfg.RedisGroup); err != nil {
			log.Printf("trim of acknowledged entries in %s failed: %v", stream, err)
		}
	}
}

// reclaimStale takes over pending entries that have sat unacknowledged longer than
// WorkerReclaimMinIdleMS, which happens when a consumer crashes between XReadGroup and
// XAck. Without this, those events would stay stuck in the group's PEL forever: never
// reprocessed, never dead-lettered, effectively dropped from the audit trail.
func (w Worker) reclaimStale(ctx context.Context) error {
	cursor := "0-0"
	for {
		nextCursor, messages, err := w.stream.XAutoClaim(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, w.cfg.RedisConsumer, w.cfg.WorkerReclaimMinIdleMS, cursor, w.cfg.WorkerBatchCount)
		if err != nil {
			return err
		}
		for _, message := range messages {
			log.Printf("reclaimed stale pending event %s", message.ID)
			metrics.EventsReclaimed.Inc()
			w.handleMessage(ctx, message)
		}
		if len(messages) == 0 || nextCursor == "0-0" || nextCursor == cursor {
			return nil
		}
		cursor = nextCursor
	}
}

// handleMessage processes one message and always resolves it: on success it's
// acknowledged, on failure it's recorded and dead-lettered before being acknowledged.
// Shared by the main read loop and reclaimStale so both paths handle failures identically.
func (w Worker) handleMessage(ctx context.Context, message redisstream.Message) {
	if err := w.process(ctx, message); err != nil {
		w.fail(ctx, message, err)
	}
	if err := w.stream.XAck(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, message.ID); err != nil {
		log.Printf("ack %s failed: %v", message.ID, err)
	}
}

func (w Worker) processRejected(ctx context.Context) error {
	messages, err := w.stream.XReadGroup(ctx, w.cfg.RedisGroup, w.cfg.RedisConsumer, w.cfg.RedisRejectedStream, w.cfg.WorkerBatchCount, 0)
	if err != nil {
		return err
	}
	for _, message := range messages {
		if err := w.writer.RecordFailure(ctx, message.ID, message.Fields, errors.New(message.Fields["error"])); err != nil {
			log.Printf("record rejected event %s failed: %v", message.ID, err)
			continue
		}
		if err := w.stream.XAck(ctx, w.cfg.RedisRejectedStream, w.cfg.RedisGroup, message.ID); err != nil {
			log.Printf("ack rejected %s failed: %v", message.ID, err)
		}
	}
	return nil
}

// fail records a message that could not be processed and sends it to the DLQ.
func (w Worker) fail(ctx context.Context, message redisstream.Message, err error) {
	log.Printf("event %s failed: %v", message.ID, err)
	metrics.EventsProcessingFailed.WithLabelValues(metrics.SafeSourceLabel(message.Fields["source"])).Inc()
	if recordErr := w.writer.RecordFailure(ctx, message.ID, message.Fields, err); recordErr != nil {
		log.Printf("record failure %s failed: %v", message.ID, recordErr)
	}
	_, _ = w.stream.XAdd(ctx, w.cfg.RedisDLQStream, w.cfg.RedisMaxLen, map[string]string{
		"sourceStreamId": message.ID,
		"error":          err.Error(),
		"payload":        message.Fields["payload"],
	})
}

// parseMessage turns a stream entry into the ingested event it carries.
func parseMessage(message redisstream.Message) (events.IngestedEvent, error) {
	payload := map[string]any{}
	if raw := message.Fields["payload"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return events.IngestedEvent{}, err
		}
	}

	receivedAt := time.Now().UTC()
	if raw := message.Fields["receivedAt"]; raw != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			receivedAt = parsed
		}
	}

	return events.IngestedEvent{
		Source:        message.Fields["source"],
		EventType:     message.Fields["eventType"],
		SourceEventID: message.Fields["sourceEventId"],
		RawEventHash:  message.Fields["rawEventHash"],
		ReceivedAt:    receivedAt,
		Payload:       payload,
	}, nil
}

func (w Worker) process(ctx context.Context, message redisstream.Message) error {
	event, err := parseMessage(message)
	if err != nil {
		return err
	}
	canonical := events.Normalize(event)
	block, err := w.writer.AppendEvent(ctx, canonical)
	if err != nil {
		if errors.Is(err, hashchain.ErrDuplicateEvent) {
			if markErr := w.writer.MarkDuplicate(ctx, canonical); markErr != nil {
				log.Printf("mark duplicate %s failed: %v", event.SourceEventID, markErr)
			}
			metrics.EventsDuplicate.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
			log.Printf("skipping duplicate external event %s", event.SourceEventID)
			return nil
		}
		return err
	}
	if block.Index < 0 {
		metrics.EventsRecorded.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
		log.Printf("recorded external event %s (pending chaining)", event.SourceEventID)
		return nil
	}
	metrics.BlocksAppended.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
	log.Printf("appended external event %s as block %d", event.SourceEventID, block.Index)
	return nil
}
