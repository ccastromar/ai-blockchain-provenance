package opentelemetry

import (
	"encoding/json"
	"testing"
)

func TestAdaptOTLPLogsPayload(t *testing.T) {
	raw := []byte(`{
		"resourceLogs": [{
			"resource": {
				"attributes": [
					{ "key": "service.name", "value": { "stringValue": "loan-api" } },
					{ "key": "ai.provider", "value": { "stringValue": "internal-gateway" } }
				]
			},
			"scopeLogs": [{
				"logRecords": [{
					"timeUnixNano": "1782900000000000000",
					"traceId": "abc123",
					"spanId": "def456",
					"body": { "stringValue": "ai inference completed" },
					"attributes": [
						{ "key": "ai.model.id", "value": { "stringValue": "credit-risk-prod" } },
						{ "key": "ai.inference.id", "value": { "stringValue": "inf-123" } },
						{ "key": "ai.input.hash", "value": { "stringValue": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
						{ "key": "ai.output.hash", "value": { "stringValue": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
						{ "key": "ai.model.version", "value": { "stringValue": "12" } }
					]
				}]
			}]
		}]
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := AdaptAll(payload, raw)
	if len(got) != 1 {
		t.Fatalf("expected one event, got %d", len(got))
	}
	event := got[0]
	if event.Source != "opentelemetry" {
		t.Fatalf("source mismatch: %s", event.Source)
	}
	if event.EventType != "inference.logged" {
		t.Fatalf("event type mismatch: %s", event.EventType)
	}
	if event.SourceEventID != "otel:inf-123:abc123:def456:0" {
		t.Fatalf("source event id mismatch: %s", event.SourceEventID)
	}
	if event.Payload["modelId"] != "credit-risk-prod" {
		t.Fatalf("model id mismatch: %#v", event.Payload["modelId"])
	}
	if event.Payload["inferenceId"] != "inf-123" {
		t.Fatalf("inference id mismatch: %#v", event.Payload["inferenceId"])
	}
	if event.Payload["inputHash"] == "" || event.Payload["outputHash"] == "" {
		t.Fatalf("expected hashes in payload: %#v", event.Payload)
	}
	if event.Payload["version"] != "12" {
		t.Fatalf("version mismatch: %#v", event.Payload["version"])
	}
}

func TestAdaptSimpleLogsPayload(t *testing.T) {
	raw := []byte(`{
		"logs": [{
			"time": "2026-07-01T09:00:00Z",
			"traceId": "trace-1",
			"spanId": "span-1",
			"body": "inference completed",
			"attributes": {
				"ai.model.id": "fraud-prod",
				"ai.request.id": "req-1",
				"ai.input.hash": "input-hash",
				"ai.output.hash": "output-hash"
			}
		}]
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := AdaptAll(payload, raw)
	if len(got) != 1 {
		t.Fatalf("expected one event, got %d", len(got))
	}
	if got[0].Payload["modelId"] != "fraud-prod" {
		t.Fatalf("model id mismatch: %#v", got[0].Payload["modelId"])
	}
	if got[0].Payload["inferenceId"] != "req-1" {
		t.Fatalf("inference id mismatch: %#v", got[0].Payload["inferenceId"])
	}
}

func TestAdaptBatchLogs(t *testing.T) {
	raw := []byte(`{
		"logs": [
			{ "attributes": { "ai.model.id": "m1", "ai.inference.id": "i1" } },
			{ "attributes": { "ai.model.id": "m1", "ai.inference.id": "i2" } }
		]
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := AdaptAll(payload, raw)
	if len(got) != 2 {
		t.Fatalf("expected two events, got %d", len(got))
	}
	if got[1].SourceEventID != "otel:i2:1" {
		t.Fatalf("source event id mismatch: %s", got[1].SourceEventID)
	}
}
