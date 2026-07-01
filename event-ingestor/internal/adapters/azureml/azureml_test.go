package azureml

import (
	"encoding/json"
	"testing"
)

func TestAdaptModelRegistered(t *testing.T) {
	raw := []byte(`{
		"id": "evt-az-1",
		"eventType": "Microsoft.MachineLearningServices.ModelRegistered",
		"subject": "/workspaces/ernest/models/credit-risk-azure/versions/12",
		"eventTime": "2026-07-01T09:00:00Z",
		"data": {
			"workspaceName": "ernest-ml",
			"modelName": "credit-risk-azure",
			"modelVersion": "12",
			"modelUri": "azureml://registries/ernest/models/credit-risk-azure/versions/12",
			"artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"gitCommit": "abcdef123456"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "azureml" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.registered" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-azure" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "12" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
	if got.Payload["artifactHash"] != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("artifactHash mismatch: %#v", got.Payload["artifactHash"])
	}
}

func TestAdaptRunCompleted(t *testing.T) {
	raw := []byte(`{
		"id": "evt-az-2",
		"eventType": "Microsoft.MachineLearningServices.RunStatusChanged",
		"subject": "/workspaces/ernest/runs/run-123",
		"data": {
			"jobName": "credit-risk-training",
			"runId": "run-123",
			"status": "Completed",
			"metrics": { "auc": 0.92 }
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "training.completed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-training" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
}

func TestAdaptEndpointDeployment(t *testing.T) {
	raw := []byte(`{
		"id": "evt-az-3",
		"eventType": "Microsoft.MachineLearningServices.EndpointDeploymentStatusChanged",
		"subject": "/workspaces/ernest/endpoints/credit-risk-prod/deployments/blue",
		"data": {
			"endpointName": "credit-risk-prod",
			"deploymentName": "blue",
			"status": "Succeeded"
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

func TestAdaptDriftDetected(t *testing.T) {
	raw := []byte(`{
		"id": "evt-az-4",
		"eventType": "Microsoft.MachineLearningServices.DataDriftDetected",
		"data": {
			"modelName": "credit-risk-azure",
			"metricName": "population_stability_index",
			"status": "Detected"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "drift.detected" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
}
