// Package kafkasource records the events of Kafka topics (ADR-005): the transport for
// high-volume, fire-and-forget evidence streams such as Prudence's PDP decisions.
//
// Each poll is recorded as one batch through the same writer the Redis worker uses, so an
// event lands exactly as it would through POST /events. A poll's offsets are committed only
// after every record in it is durably recorded — as an event, a duplicate or a recorded
// failure. Infrastructure errors (MongoDB unreachable) are retried on the same records and
// never committed past, so delivery is at-least-once and replays are deduplicated.
package kafkasource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/ingest"
	"event-ingestor/internal/metrics"

	"github.com/twmb/franz-go/pkg/kgo"
	"go.mongodb.org/mongo-driver/mongo"
)

// VerificationStatus marks events whose origin rests on the broker's authentication and the
// topic's write ACL (the HTTP path's equivalent is "shared_secret").
const VerificationStatus = "kafka_acl"

// Record headers carrying the POST /events headers (ADR-005 record contract).
const (
	HeaderSource        = "source"
	HeaderEventType     = "eventType"
	HeaderSourceEventID = "sourceEventId"
)

type Config struct {
	Brokers        []string
	Topics         []string
	Group          string
	MaxPollRecords int
}

// Writer is the subset of hashchain.MongoWriter the source depends on.
type Writer interface {
	EnsureIndexes(ctx context.Context) error
	AppendEvent(ctx context.Context, event events.CanonicalEvent) (hashchain.Block, error)
	RecordFailure(ctx context.Context, sourceStreamID string, fields map[string]string, processErr error) error
	MarkDuplicate(ctx context.Context, event events.CanonicalEvent) error
}

// BatchWriter records a whole poll in a few round trips (ADR-004 mode).
type BatchWriter interface {
	RecordsEvents() bool
	RecordEvents(ctx context.Context, batch []events.CanonicalEvent) []error
}

func Run(ctx context.Context, cfg Config, writer Writer) error {
	if len(cfg.Brokers) == 0 || len(cfg.Topics) == 0 || cfg.Group == "" {
		return errors.New("kafka source needs KAFKA_BROKERS, KAFKA_TOPICS and KAFKA_GROUP")
	}
	if cfg.MaxPollRecords <= 0 {
		cfg.MaxPollRecords = 1000
	}
	client, err := kgo.NewClient(
		kgo.SeedBrokers(cfg.Brokers...),
		kgo.ConsumerGroup(cfg.Group),
		kgo.ConsumeTopics(cfg.Topics...),
		// Offsets are committed by hand, after the records are recorded.
		kgo.DisableAutoCommit(),
		// Partitions are not revoked between a poll and its commit.
		kgo.BlockRebalanceOnPoll(),
	)
	if err != nil {
		return err
	}
	defer client.Close()

	if err := writer.EnsureIndexes(ctx); err != nil {
		return err
	}
	log.Printf("kafka source: brokers=%s topics=%s group=%s", strings.Join(cfg.Brokers, ","), strings.Join(cfg.Topics, ","), cfg.Group)

	for {
		fetches := client.PollRecords(ctx, cfg.MaxPollRecords)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			return ctx.Err()
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			log.Printf("kafka fetch %s[%d] failed: %v", topic, partition, err)
		})
		records := fetches.Records()
		if len(records) == 0 {
			client.AllowRebalance()
			continue
		}

		backoff := 500 * time.Millisecond
		for {
			err := record(ctx, writer, records)
			if err == nil {
				break
			}
			log.Printf("kafka source: %d records not recorded, retrying in %s: %v", len(records), backoff, err)
			select {
			case <-ctx.Done():
				client.AllowRebalance()
				return ctx.Err()
			case <-time.After(backoff):
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
		if err := client.CommitRecords(ctx, records...); err != nil {
			// Not fatal: the records are recorded; a replay after a crash is deduplicated.
			log.Printf("kafka source: commit of %d records failed: %v", len(records), err)
		}
		client.AllowRebalance()
	}
}

// record stores one poll. It returns an error only for failures that may succeed on retry
// (infrastructure); a bad record is recorded as a failure and does not stop the rest.
func record(ctx context.Context, writer Writer, records []*kgo.Record) error {
	batch := make([]events.CanonicalEvent, 0, len(records))
	positions := make([]int, 0, len(records))
	for i, rec := range records {
		event, err := ingestedEvent(rec)
		if err != nil {
			if err := recordFailure(ctx, writer, rec, err); err != nil {
				return err
			}
			continue
		}
		batch = append(batch, events.Normalize(event))
		positions = append(positions, i)
	}
	if len(batch) == 0 {
		return nil
	}

	var outcomes []error
	if bw, ok := writer.(BatchWriter); ok && bw.RecordsEvents() {
		outcomes = bw.RecordEvents(ctx, batch)
	} else {
		outcomes = make([]error, len(batch))
		for j, event := range batch {
			block, err := writer.AppendEvent(ctx, event)
			outcomes[j] = err
			if err == nil && block.Index >= 0 {
				metrics.BlocksAppended.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
			}
		}
	}

	recorded, duplicates, failed := 0, 0, 0
	for j, err := range outcomes {
		event := batch[j]
		switch {
		case err == nil:
			recorded++
			metrics.EventsRecorded.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
		case errors.Is(err, hashchain.ErrDuplicateEvent):
			duplicates++
			if markErr := writer.MarkDuplicate(ctx, event); markErr != nil && transient(markErr) {
				return markErr
			}
			metrics.EventsDuplicate.WithLabelValues(metrics.SafeSourceLabel(event.Source)).Inc()
		case transient(err):
			// Nothing is committed; the whole poll is retried and what was stored replays
			// as duplicates.
			return err
		default:
			failed++
			if err := recordFailure(ctx, writer, records[positions[j]], err); err != nil {
				return err
			}
		}
	}
	log.Printf("kafka source: recorded %d events, %d duplicates, %d failed", recorded, duplicates, failed)
	return nil
}

// ingestedEvent maps a record onto the event POST /events would have received (ADR-005).
func ingestedEvent(rec *kgo.Record) (events.IngestedEvent, error) {
	headers := map[string]string{}
	for _, h := range rec.Headers {
		headers[h.Key] = string(h.Value)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Value, &payload); err != nil || payload == nil {
		return events.IngestedEvent{}, errors.New("invalid json payload")
	}
	ingest.AttachVerification(payload, VerificationStatus)
	sum := sha256.Sum256(rec.Value)
	rawHash := hex.EncodeToString(sum[:])
	return events.IngestedEvent{
		Source:        firstNonEmpty(headers[HeaderSource], stringFrom(payload, "source"), "unknown"),
		EventType:     firstNonEmpty(headers[HeaderEventType], stringFrom(payload, "eventType"), stringFrom(payload, "type"), "unknown"),
		SourceEventID: firstNonEmpty(headers[HeaderSourceEventID], string(rec.Key), stringFrom(payload, "sourceEventId"), stringFrom(payload, "id"), rawHash),
		ReceivedAt:    rec.Timestamp.UTC(),
		RawEventHash:  rawHash,
		Payload:       payload,
	}, nil
}

func recordFailure(ctx context.Context, writer Writer, rec *kgo.Record, cause error) error {
	metrics.EventsProcessingFailed.WithLabelValues("kafka").Inc()
	id := "kafka:" + rec.Topic + "/" + strconv.Itoa(int(rec.Partition)) + "@" + strconv.FormatInt(rec.Offset, 10)
	log.Printf("event %s failed: %v", id, cause)
	fields := map[string]string{"payload": string(rec.Value), "kafkaTopic": rec.Topic}
	for _, h := range rec.Headers {
		fields[h.Key] = string(h.Value)
	}
	if err := writer.RecordFailure(ctx, id, fields, cause); err != nil {
		return fmt.Errorf("record failure %s: %w", id, err)
	}
	return nil
}

// transient reports failures worth retrying on the same records (the store, not the record).
func transient(err error) bool {
	return mongo.IsNetworkError(err) || mongo.IsTimeout(err) ||
		errors.Is(err, context.DeadlineExceeded) || errors.Is(err, mongo.ErrClientDisconnected) ||
		strings.Contains(err.Error(), "server selection")
}

func stringFrom(payload map[string]any, key string) string {
	if s, ok := payload[key].(string); ok {
		return s
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
