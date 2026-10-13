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
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/ingest"
	"event-ingestor/internal/metrics"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"
	"go.mongodb.org/mongo-driver/mongo"
)

// VerificationStatus marks events whose origin rests on the broker's authentication and the
// topic's write ACL (the HTTP path's equivalent is "shared_secret"). It is recorded only when
// Ernest itself connects with SASL — i.e. the cluster authenticates its clients; otherwise the
// events are recorded "unverified", as HTTP events are when no ingestor key is configured.
const VerificationStatus = "kafka_acl"

// UnverifiedStatus is recorded for events read over a connection without client authentication.
const UnverifiedStatus = "unverified"

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
	Security       Security
}

// Security is how the consumer connects to the brokers (ADR-005).
type Security struct {
	Protocol     string // PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
	SASLMech     string // SCRAM-SHA-512 (default) | SCRAM-SHA-256 | PLAIN
	SASLUsername string
	SASLPassword string
	TLSCAFile    string // PEM bundle of a private CA; system roots otherwise
}

// options turns Security into client options, and reports whether clients are authenticated.
func (s Security) options() ([]kgo.Opt, bool, error) {
	protocol := strings.ToUpper(strings.TrimSpace(s.Protocol))
	if protocol == "" {
		protocol = "PLAINTEXT"
	}
	var opts []kgo.Opt
	useTLS, useSASL := false, false
	switch protocol {
	case "PLAINTEXT":
	case "SSL":
		useTLS = true
	case "SASL_PLAINTEXT":
		useSASL = true
	case "SASL_SSL":
		useTLS, useSASL = true, true
	default:
		return nil, false, fmt.Errorf("KAFKA_SECURITY_PROTOCOL must be PLAINTEXT, SSL, SASL_PLAINTEXT or SASL_SSL (was %q)", s.Protocol)
	}
	if useTLS {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if s.TLSCAFile != "" {
			pem, err := os.ReadFile(s.TLSCAFile)
			if err != nil {
				return nil, false, fmt.Errorf("KAFKA_TLS_CA_FILE: %w", err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(pem) {
				return nil, false, fmt.Errorf("KAFKA_TLS_CA_FILE: no PEM certificate in %s", s.TLSCAFile)
			}
			tlsCfg.RootCAs = pool
		}
		opts = append(opts, kgo.DialTLSConfig(tlsCfg))
	}
	if useSASL {
		if s.SASLUsername == "" || s.SASLPassword == "" {
			return nil, false, errors.New("SASL needs KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD")
		}
		switch strings.ToUpper(strings.TrimSpace(firstNonEmpty(s.SASLMech, "SCRAM-SHA-512"))) {
		case "SCRAM-SHA-512":
			opts = append(opts, kgo.SASL(scram.Auth{User: s.SASLUsername, Pass: s.SASLPassword}.AsSha512Mechanism()))
		case "SCRAM-SHA-256":
			opts = append(opts, kgo.SASL(scram.Auth{User: s.SASLUsername, Pass: s.SASLPassword}.AsSha256Mechanism()))
		case "PLAIN":
			opts = append(opts, kgo.SASL(plain.Auth{User: s.SASLUsername, Pass: s.SASLPassword}.AsMechanism()))
		default:
			return nil, false, fmt.Errorf("KAFKA_SASL_MECHANISM must be SCRAM-SHA-512, SCRAM-SHA-256 or PLAIN (was %q)", s.SASLMech)
		}
	}
	return opts, useSASL, nil
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
	securityOpts, authenticated, err := cfg.Security.options()
	if err != nil {
		return err
	}
	status := UnverifiedStatus
	if authenticated {
		status = VerificationStatus
	} else {
		log.Printf("kafka source: WARNING clients are not authenticated (%s): events are recorded %q; use SASL_SSL in production",
			firstNonEmpty(cfg.Security.Protocol, "PLAINTEXT"), UnverifiedStatus)
	}
	client, err := kgo.NewClient(append(securityOpts,
		kgo.SeedBrokers(cfg.Brokers...),
		kgo.ConsumerGroup(cfg.Group),
		kgo.ConsumeTopics(cfg.Topics...),
		// Offsets are committed by hand, after the records are recorded.
		kgo.DisableAutoCommit(),
		// Partitions are not revoked between a poll and its commit.
		kgo.BlockRebalanceOnPoll(),
	)...)
	if err != nil {
		return err
	}
	defer client.Close()

	if err := writer.EnsureIndexes(ctx); err != nil {
		return err
	}
	log.Printf("kafka source: brokers=%s topics=%s group=%s security=%s", strings.Join(cfg.Brokers, ","), strings.Join(cfg.Topics, ","), cfg.Group, firstNonEmpty(cfg.Security.Protocol, "PLAINTEXT"))

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
			err := record(ctx, writer, records, status)
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
func record(ctx context.Context, writer Writer, records []*kgo.Record, status string) error {
	batch := make([]events.CanonicalEvent, 0, len(records))
	positions := make([]int, 0, len(records))
	for i, rec := range records {
		event, err := ingestedEvent(rec, status)
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
func ingestedEvent(rec *kgo.Record, status string) (events.IngestedEvent, error) {
	headers := map[string]string{}
	for _, h := range rec.Headers {
		headers[h.Key] = string(h.Value)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Value, &payload); err != nil || payload == nil {
		return events.IngestedEvent{}, errors.New("invalid json payload")
	}
	ingest.AttachVerification(payload, status)
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
