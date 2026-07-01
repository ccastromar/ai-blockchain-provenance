package databricks

import (
	"encoding/json"
	"testing"
)

func TestAdaptModelVersionCreated(t *testing.T) {
	raw := []byte(`{
		"id": "dbx-1",
		"eventType": "model.version.created",
		"workspaceId": "12345",
		"time": "2026-07-01T09:00:00Z",
		"data": {
			"full_name": "prod.ml_team.credit_risk",
			"version": "8",
			"source": "dbfs:/models/credit_risk/8",
			"artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"run_id": "run-123",
			"metrics": { "auc": 0.95 }
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "databricks" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.version.created" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "prod.ml_team.credit_risk" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "8" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
}

func TestAdaptChampionAliasAsDeployment(t *testing.T) {
	raw := []byte(`{
		"id": "dbx-2",
		"eventType": "model.alias.updated",
		"data": {
			"fullName": "prod.ml_team.credit_risk",
			"version": "9",
			"alias": "Champion"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "model.deployed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
}

func TestAdaptLineageAsDatasetLinked(t *testing.T) {
	raw := []byte(`{
		"id": "dbx-3",
		"eventType": "model.lineage.updated",
		"data": {
			"fullName": "prod.ml_team.credit_risk",
			"version": "10",
			"inputs": [
				{ "fullName": "prod.features.loan_features" }
			]
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "dataset.linked" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	metadata := got.Payload["metadata"].(map[string]any)
	lineage := metadata["lineage"].(map[string]any)
	if lineage["inputCount"] != 1 {
		t.Fatalf("lineage inputCount mismatch: %#v", lineage["inputCount"])
	}
}
