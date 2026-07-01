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
	"event-ingestor/internal/redisstream"
)

type Worker struct {
	stream *redisstream.Client
	writer hashchain.MongoWriter
	cfg    config.Config
}

func New(stream *redisstream.Client, writer hashchain.MongoWriter, cfg config.Config) Worker {
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
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := w.processRejected(ctx); err != nil {
			log.Printf("rejected event processing failed: %v", err)
		}

		messages, err := w.stream.XReadGroup(ctx, w.cfg.RedisGroup, w.cfg.RedisConsumer, w.cfg.RedisStream, w.cfg.WorkerBatchCount, w.cfg.WorkerBlockMS)
		if err != nil {
			log.Printf("redis read failed: %v", err)
			time.Sleep(time.Second)
			continue
		}
		for _, message := range messages {
			if err := w.process(ctx, message); err != nil {
				log.Printf("event %s failed: %v", message.ID, err)
				if recordErr := w.writer.RecordFailure(ctx, message.ID, message.Fields, err); recordErr != nil {
					log.Printf("record failure %s failed: %v", message.ID, recordErr)
				}
				_, _ = w.stream.XAdd(ctx, w.cfg.RedisDLQStream, w.cfg.RedisMaxLen, map[string]string{
					"sourceStreamId": message.ID,
					"error":          err.Error(),
					"payload":        message.Fields["payload"],
				})
				_ = w.stream.XAck(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, message.ID)
				continue
			}
			if err := w.stream.XAck(ctx, w.cfg.RedisStream, w.cfg.RedisGroup, message.ID); err != nil {
				log.Printf("ack %s failed: %v", message.ID, err)
			}
		}
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
			log.Printf("skipping duplicate external event %s", event.SourceEventID)
			return nil
		}
		return err
	}
	log.Printf("appended external event %s as block %d", event.SourceEventID, block.Index)
	return nil
}
