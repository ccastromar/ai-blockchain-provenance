package openlineage

import (
	"encoding/json"
	"testing"
)

func TestAdaptCompleteRun(t *testing.T) {
	raw := []byte(`{
		"eventType": "COMPLETE",
		"eventTime": "2026-07-01T09:00:00Z",
		"run": {
			"runId": "run-123",
			"facets": {
				"ernest": {
					"modelId": "credit-risk-xgb",
					"version": "9",
					"artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"metrics": { "auc": 0.93 }
				},
				"sourceCode": { "gitCommit": "abcdef1234567890" }
			}
		},
		"job": {
			"namespace": "training",
			"name": "credit-risk-train"
		},
		"inputs": [
			{ "namespace": "warehouse", "name": "credit/features", "facets": { "version": { "version": "2026-07-01" } } }
		],
		"outputs": [
			{ "namespace": "registry", "name": "credit-risk-xgb", "facets": { "ernest": { "hash": "bbbb" } } }
		]
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "openlineage" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "training.completed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.SourceEventID != "ol:run-123:training:credit-risk-train:COMPLETE" {
		t.Fatalf("source event id mismatch: %s", got.SourceEventID)
	}
	if got.Payload["modelId"] != "credit-risk-xgb" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "9" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
	if got.Payload["artifactHash"] != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("artifactHash mismatch: %#v", got.Payload["artifactHash"])
	}
	metadata := got.Payload["metadata"].(map[string]any)
	if metadata["inputDatasetCount"] != 1 {
		t.Fatalf("inputDatasetCount mismatch: %#v", metadata["inputDatasetCount"])
	}
	if metadata["outputDatasetCount"] != 1 {
		t.Fatalf("outputDatasetCount mismatch: %#v", metadata["outputDatasetCount"])
	}
}

func TestAdaptStartRunFallsBackToJobName(t *testing.T) {
	raw := []byte(`{
		"eventType": "START",
		"run": { "runId": "run-456" },
		"job": { "namespace": "training", "name": "fraud-train" }
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "training.started" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "fraud-train" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
}

func TestAdaptDatasetOnlyUnknownEvent(t *testing.T) {
	raw := []byte(`{
		"eventType": "OTHER",
		"job": { "namespace": "lineage", "name": "dataset-refresh" },
		"inputs": [{ "namespace": "warehouse", "name": "features" }]
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "dataset.linked" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
}
