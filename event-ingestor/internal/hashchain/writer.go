package hashchain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"event-ingestor/internal/events"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const maxAppendRetries = 3

var ErrDuplicateEvent = errors.New("duplicate ingested event")

type MongoWriter struct {
	db *mongo.Database
}

type Block struct {
	Index        int64          `bson:"index" json:"index"`
	Timestamp    int64          `bson:"timestamp" json:"timestamp"`
	Data         map[string]any `bson:"data" json:"data"`
	PreviousHash string         `bson:"previousHash" json:"previousHash"`
	Hash         string         `bson:"hash" json:"hash"`
}

func NewMongoWriter(db *mongo.Database) MongoWriter {
	return MongoWriter{db: db}
}

func (w MongoWriter) EnsureIndexes(ctx context.Context) error {
	opCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Unique on "index" is what turns a concurrent append race into an E11000 that
	// AppendEvent's retry loop already knows how to handle (see appendOnce/isDuplicateKey).
	// Without it, two writers could insert two blocks with the same index and diverging
	// hashes, silently forking the chain. This must not depend on the NestJS backend
	// having started first and created it via its Mongoose schema -- but on a database
	// that predates this coordination (or was created by an older Mongoose autoIndex
	// under a different name, e.g. "index_1"), an equivalent unique index may already
	// exist under a different name, which MongoDB rejects as IndexOptionsConflict rather
	// than treating as a no-op. ignoreIndexConflict tolerates that case.
	blocks := w.db.Collection("provenanceblocks")
	if err := ignoreIndexConflict(blocks.Indexes().CreateOne(opCtx, mongo.IndexModel{
		Keys:    bson.D{{Key: "index", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("unique_block_index"),
	})); err != nil {
		return err
	}
	if err := ignoreIndexConflict(blocks.Indexes().CreateOne(opCtx, mongo.IndexModel{
		Keys:    bson.D{{Key: "hash", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("unique_block_hash"),
	})); err != nil {
		return err
	}

	// Same tolerance for every remaining index: the NestJS backend's Mongoose schemas
	// declare equivalent indexes under their own auto-generated names (e.g.
	// "source_1_sourceEventId_1_eventType_1"), and whichever process reaches Mongo
	// first wins the name.
	events := w.db.Collection("ingested_events")
	if err := ignoreIndexConflict(events.Indexes().CreateOne(opCtx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "source", Value: 1},
			{Key: "sourceEventId", Value: 1},
			{Key: "eventType", Value: 1},
		},
		Options: options.Index().SetUnique(true).SetName("unique_source_event_type"),
	})); err != nil {
		return err
	}
	if err := ignoreIndexConflict(events.Indexes().CreateOne(opCtx, mongo.IndexModel{
		Keys: bson.D{{Key: "verificationStatus", Value: 1}},
	})); err != nil {
		return err
	}

	failures := w.db.Collection("event_failures")
	failureIndexes := []mongo.IndexModel{
		{Keys: bson.D{{Key: "failedAt", Value: -1}}},
		{Keys: bson.D{{Key: "source", Value: 1}, {Key: "eventType", Value: 1}}},
		{Keys: bson.D{{Key: "failureKind", Value: 1}, {Key: "authFailureType", Value: 1}}},
	}
	for _, model := range failureIndexes {
		if err := ignoreIndexConflict(failures.Indexes().CreateOne(opCtx, model)); err != nil {
			return err
		}
	}
	return nil
}

func (w MongoWriter) AppendEvent(ctx context.Context, event events.CanonicalEvent) (Block, error) {
	if err := w.markIngested(ctx, event); err != nil {
		return Block{}, err
	}

	data := map[string]any{}
	raw, err := json.Marshal(event)
	if err != nil {
		return Block{}, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&data); err != nil {
		return Block{}, err
	}

	// Pin all numbers to float64 before hashing AND storing, rejecting integers beyond
	// 2^53 (see NormalizeNumbers): what gets hashed must be exactly what every verifier
	// reads back from BSON later.
	normalized, err := NormalizeNumbers(data)
	if err != nil {
		return Block{}, fmt.Errorf("event contains a non-portable number: %w", err)
	}
	data = normalized.(map[string]any)

	for attempt := 1; attempt <= maxAppendRetries; attempt++ {
		block, err := w.appendOnce(ctx, data)
		if err == nil {
			_ = w.upsertAIModel(ctx, event)
			_ = w.markAppended(ctx, event, block)
			return block, nil
		}
		if !isDuplicateKey(err) || attempt == maxAppendRetries {
			return Block{}, err
		}
	}

	return Block{}, errors.New("could not append block after retries")
}

func (w MongoWriter) RecordFailure(ctx context.Context, sourceStreamID string, fields map[string]string, processErr error) error {
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	payload := map[string]any{}
	if raw := fields["payload"]; raw != "" {
		_ = json.Unmarshal([]byte(raw), &payload)
	}

	_, err := w.db.Collection("event_failures").InsertOne(opCtx, failureDocument(sourceStreamID, fields, processErr.Error(), payload, time.Now().UTC()))
	return err
}

func (w MongoWriter) MarkDuplicate(ctx context.Context, event events.CanonicalEvent) error {
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := w.db.Collection("ingested_events").UpdateOne(
		opCtx,
		bson.M{
			"source":        event.Source,
			"sourceEventId": event.SourceEventID,
			"eventType":     event.Metadata["eventType"],
		},
		bson.M{
			"$set": bson.M{
				"status":          "duplicate",
				"duplicateSeenAt": time.Now().UTC(),
			},
			"$inc": bson.M{
				"duplicateCount": 1,
			},
		},
	)
	return err
}

func (w MongoWriter) markIngested(ctx context.Context, event events.CanonicalEvent) error {
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := w.db.Collection("ingested_events").InsertOne(opCtx, ingestedEventDocument(event, time.Now().UTC()))
	if err != nil {
		if isDuplicateKey(err) {
			return ErrDuplicateEvent
		}
		return err
	}
	return nil
}

func (w MongoWriter) markAppended(ctx context.Context, event events.CanonicalEvent, block Block) error {
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := w.db.Collection("ingested_events").UpdateOne(
		opCtx,
		bson.M{
			"source":        event.Source,
			"sourceEventId": event.SourceEventID,
			"eventType":     event.Metadata["eventType"],
		},
		bson.M{
			"$set": bson.M{
				"status":     "appended",
				"blockIndex": block.Index,
				"blockHash":  block.Hash,
				"appendedAt": time.Now().UTC(),
			},
		},
	)
	return err
}

func (w MongoWriter) upsertAIModel(ctx context.Context, event events.CanonicalEvent) error {
	if event.ModelID == "" {
		return nil
	}

	payload, _ := event.Metadata["payload"].(map[string]any)
	version := event.Version
	if version == "" {
		version = "external"
	}

	name := event.ModelName
	if name == "" {
		name = event.ModelID
	}

	payloadMetadata, _ := payload["metadata"].(map[string]any)

	metadata := map[string]any{
		"source":        event.Source,
		"sourceEventId": event.SourceEventID,
		"rawEventHash":  event.RawEventHash,
		"eventType":     event.Metadata["eventType"],
		"canonicalType": event.Type,
	}
	if event.ModelHash != "" {
		metadata["artifactHash"] = event.ModelHash
	}
	for key, value := range payloadMetadata {
		metadata[key] = value
	}

	now := time.Now().UTC()
	opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := w.db.Collection("aimodels").UpdateOne(
		opCtx,
		bson.M{"modelId": event.ModelID, "version": version},
		bson.M{
			"$set": bson.M{
				"name":       name,
				"status":     "active",
				"parameters": event.Params,
				"metrics":    event.Metrics,
				"metadata":   metadata,
				"updatedAt":  now,
			},
			"$setOnInsert": bson.M{
				"modelId":   event.ModelID,
				"version":   version,
				"createdAt": now,
			},
		},
		options.Update().SetUpsert(true),
	)
	return err
}

func stringValue(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func ingestedEventDocument(event events.CanonicalEvent, receivedAt time.Time) bson.M {
	document := bson.M{
		"source":        event.Source,
		"sourceEventId": event.SourceEventID,
		"eventType":     event.Metadata["eventType"],
		"rawEventHash":  event.RawEventHash,
		"status":        "processing",
		"receivedAt":    receivedAt,
	}
	for key, value := range verificationFields(event) {
		document[key] = value
	}
	return document
}

func failureDocument(sourceStreamID string, fields map[string]string, errorMessage string, payload map[string]any, failedAt time.Time) bson.M {
	return bson.M{
		"sourceStreamId":  sourceStreamID,
		"source":          fields["source"],
		"sourceEventId":   fields["sourceEventId"],
		"eventType":       fields["eventType"],
		"rawEventHash":    fields["rawEventHash"],
		"error":           errorMessage,
		"failureKind":     firstNonEmpty(fields["failureKind"], "processing_failed"),
		"authFailureType": fields["authFailureType"],
		"payload":         payload,
		"failedAt":        failedAt,
	}
}

func verificationFields(event events.CanonicalEvent) bson.M {
	fields := bson.M{}
	for _, key := range []string{"verificationStatus", "verificationMethod", "transportAuth"} {
		if value := stringValue(event.Metadata, key); value != "" {
			fields[key] = value
		}
	}
	return fields
}

func (w MongoWriter) appendOnce(ctx context.Context, data map[string]any) (Block, error) {
	coll := w.db.Collection("provenanceblocks")
	opCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var last Block
	err := coll.FindOne(opCtx, bson.D{}, options.FindOne().SetSort(bson.D{{Key: "index", Value: -1}})).Decode(&last)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return Block{}, errors.New("chain not initialized; genesis block missing")
		}
		return Block{}, err
	}

	// Never below the previous block's timestamp: if the host clock jumps backwards
	// (NTP correction, restored VM), a block timestamped earlier than its predecessor
	// would look like tampering to an auditor even though the chain is valid. Block
	// index stays the authoritative order; this keeps timestamps consistent with it.
	// Mirrors BlockchainService.addBlock in the NestJS backend.
	timestamp := time.Now().Unix()
	if last.Timestamp > timestamp {
		timestamp = last.Timestamp
	}

	block := Block{
		Index:        last.Index + 1,
		Timestamp:    timestamp,
		Data:         data,
		PreviousHash: last.Hash,
	}
	hash, err := CalculateHash(block)
	if err != nil {
		return Block{}, err
	}
	block.Hash = hash

	_, err = coll.InsertOne(opCtx, block)
	if err != nil {
		return Block{}, err
	}
	return block, nil
}

func CalculateHash(block Block) (string, error) {
	canonicalData, err := CanonicalJSON(block.Data)
	if err != nil {
		return "", err
	}
	blockString := fmt.Sprintf("%d|%d|%s|%s", block.Index, block.Timestamp, canonicalData, block.PreviousHash)
	sum := sha256.Sum256([]byte(blockString))
	return hex.EncodeToString(sum[:]), nil
}

// ignoreIndexConflict treats IndexOptionsConflict (85) and IndexKeySpecsConflict (86) as
// success: they mean an index covering the same keys already exists under a different
// name (e.g. Mongoose's autoIndex-generated "index_1" predating this coordination), which
// enforces the same uniqueness guarantee we need. There is nothing to fix and nothing to
// retry, so callers should proceed rather than fail startup over a naming mismatch.
func ignoreIndexConflict(_ string, err error) error {
	if err == nil {
		return nil
	}
	var cmdErr mongo.CommandError
	if errors.As(err, &cmdErr) && (cmdErr.Code == 85 || cmdErr.Code == 86) {
		return nil
	}
	return err
}

func isDuplicateKey(err error) bool {
	var writeException mongo.WriteException
	if errors.As(err, &writeException) {
		for _, writeErr := range writeException.WriteErrors {
			if writeErr.Code == 11000 {
				return true
			}
		}
	}
	return strings.Contains(err.Error(), "E11000")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
