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

		messages, err := w.stream.XReadGroup(ctx, w.cfg.RedisGroup, w.cfg.RedisConsumer, w.cfg.RedisStream, w.cfg.WorkerBatchCount, w.cfg.WorkerBlockMS)
		if err != nil {
			log.Printf("redis read failed: %v", err)
			time.Sleep(time.Second)
			continue
		}
		for _, message := range messages {
			w.handleMessage(ctx, message)
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

func (w Worker) process(ctx context.Context, message redisstream.Message) error {
	payload := map[string]any{}
	if raw := message.Fields["payload"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return err
		}
	}

	receivedAt := time.Now().UTC()
	if raw := message.Fields["receivedAt"]; raw != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			receivedAt = parsed
		}
	}

	event := events.IngestedEvent{
		Source:        message.Fields["source"],
		EventType:     message.Fields["eventType"],
		SourceEventID: message.Fields["sourceEventId"],
		RawEventHash:  message.Fields["rawEventHash"],
		ReceivedAt:    receivedAt,
		Payload:       payload,
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
	metrics.BlocksAppended.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
	log.Printf("appended external event %s as block %d", event.SourceEventID, block.Index)
	return nil
}
