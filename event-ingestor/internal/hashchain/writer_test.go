package hashchain

import (
	"testing"
	"time"

	"event-ingestor/internal/events"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

func TestIngestedEventDocumentIncludesVerificationFields(t *testing.T) {
	receivedAt := time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC)
	doc := ingestedEventDocument(events.CanonicalEvent{
		Source:        "huggingface",
		SourceEventID: "hf:event-1",
		RawEventHash:  "abc123",
		Metadata: map[string]any{
			"eventType":          "model.version.created",
			"verificationStatus": "provider_secret",
			"verificationMethod": "X-Webhook-Secret",
			"transportAuth":      "X-Ernest-Ingest-Key",
		},
	}, receivedAt)

	assertField(t, doc, "source", "huggingface")
	assertField(t, doc, "sourceEventId", "hf:event-1")
	assertField(t, doc, "eventType", "model.version.created")
	assertField(t, doc, "rawEventHash", "abc123")
	assertField(t, doc, "status", "processing")
	assertField(t, doc, "receivedAt", receivedAt)
	assertField(t, doc, "verificationStatus", "provider_secret")
	assertField(t, doc, "verificationMethod", "X-Webhook-Secret")
	assertField(t, doc, "transportAuth", "X-Ernest-Ingest-Key")
}

func TestIngestedEventDocumentOmitsEmptyVerificationFields(t *testing.T) {
	doc := ingestedEventDocument(events.CanonicalEvent{
		Source:        "sagemaker",
		SourceEventID: "aws-sm:event-1",
		Metadata: map[string]any{
			"eventType": "model.approved",
		},
	}, time.Now().UTC())

	for _, key := range []string{"verificationStatus", "verificationMethod", "transportAuth"} {
		if _, ok := doc[key]; ok {
			t.Fatalf("expected %s to be omitted", key)
		}
	}
}

func TestVerificationFieldsExtractsTopLevelMetadata(t *testing.T) {
	fields := verificationFields(events.CanonicalEvent{
		Metadata: map[string]any{
			"verificationStatus": "shared_secret",
			"verificationMethod": "X-Ernest-Ingest-Key",
			"transportAuth":      "",
		},
	})

	assertField(t, fields, "verificationStatus", "shared_secret")
	assertField(t, fields, "verificationMethod", "X-Ernest-Ingest-Key")
	if _, ok := fields["transportAuth"]; ok {
		t.Fatal("expected empty transportAuth to be omitted")
	}
}

func TestFailureDocumentDefaultsToProcessingFailed(t *testing.T) {
	failedAt := time.Date(2026, 7, 1, 9, 5, 0, 0, time.UTC)
	doc := failureDocument("stream-1", map[string]string{
		"source":        "sagemaker",
		"sourceEventId": "aws-sm:event-1",
		"eventType":     "model.approved",
		"rawEventHash":  "hash-1",
	}, "normalizer failed", map[string]any{"id": "event-1"}, failedAt)

	assertField(t, doc, "sourceStreamId", "stream-1")
	assertField(t, doc, "source", "sagemaker")
	assertField(t, doc, "sourceEventId", "aws-sm:event-1")
	assertField(t, doc, "eventType", "model.approved")
	assertField(t, doc, "rawEventHash", "hash-1")
	assertField(t, doc, "error", "normalizer failed")
	assertField(t, doc, "failureKind", "processing_failed")
	assertField(t, doc, "failedAt", failedAt)
}

func TestFailureDocumentPreservesAuthRejectedFields(t *testing.T) {
	doc := failureDocument("rejected-1", map[string]string{
		"source":          "huggingface",
		"eventType":       "unknown",
		"failureKind":     "auth_rejected",
		"authFailureType": "provider_secret",
	}, "invalid Hugging Face webhook secret", nil, time.Now().UTC())

	assertField(t, doc, "failureKind", "auth_rejected")
	assertField(t, doc, "authFailureType", "provider_secret")
	assertField(t, doc, "error", "invalid Hugging Face webhook secret")
}

func assertField(t *testing.T, doc bson.M, key string, want any) {
	t.Helper()
	if got := doc[key]; got != want {
		t.Fatalf("%s mismatch\nwant: %#v\n got: %#v", key, want, got)
	}
}

func TestIgnoreIndexConflictToleratesIndexOptionsConflict(t *testing.T) {
	err := ignoreIndexConflict("", mongo.CommandError{Code: 85, Name: "IndexOptionsConflict"})
	if err != nil {
		t.Fatalf("expected IndexOptionsConflict (85) to be tolerated, got: %v", err)
	}
}

func TestIgnoreIndexConflictToleratesIndexKeySpecsConflict(t *testing.T) {
	err := ignoreIndexConflict("", mongo.CommandError{Code: 86, Name: "IndexKeySpecsConflict"})
	if err != nil {
		t.Fatalf("expected IndexKeySpecsConflict (86) to be tolerated, got: %v", err)
	}
}

func TestIgnoreIndexConflictPropagatesOtherErrors(t *testing.T) {
	err := ignoreIndexConflict("", mongo.CommandError{Code: 13, Name: "Unauthorized"})
	if err == nil {
		t.Fatal("expected a non-index-conflict error to be propagated")
	}
}

func TestIgnoreIndexConflictPassesThroughSuccess(t *testing.T) {
	if err := ignoreIndexConflict("some-index-name", nil); err != nil {
		t.Fatalf("expected nil error to pass through as nil, got: %v", err)
	}
}
