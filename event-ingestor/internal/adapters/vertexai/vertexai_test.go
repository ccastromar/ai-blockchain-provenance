package vertexai

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestAdaptUploadModelAuditLog(t *testing.T) {
	raw := []byte(`{
		"insertId": "vertex-1",
		"logName": "projects/ernest/logs/cloudaudit.googleapis.com%2Factivity",
		"timestamp": "2026-07-01T09:00:00Z",
		"resource": {
			"type": "aiplatform.googleapis.com/Model",
			"labels": {
				"project_id": "ernest-demo",
				"location": "europe-west1"
			}
		},
		"protoPayload": {
			"serviceName": "aiplatform.googleapis.com",
			"methodName": "google.cloud.aiplatform.v1.ModelService.UploadModel",
			"resourceName": "projects/ernest-demo/locations/europe-west1/models/credit-risk-vertex",
			"authenticationInfo": {
				"principalEmail": "mlops@example.com"
			},
			"request": {
				"displayName": "Credit Risk Vertex",
				"artifactUri": "gs://ernest-models/credit-risk-vertex/1",
				"artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			},
			"response": {
				"name": "projects/ernest-demo/locations/europe-west1/models/credit-risk-vertex",
				"versionId": "1"
			}
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "vertexai" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.registered" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-vertex" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "1" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
	if got.Payload["artifactHash"] != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("artifactHash mismatch: %#v", got.Payload["artifactHash"])
	}
}

func TestAdaptPubSubWrappedDeployModelAuditLog(t *testing.T) {
	logEntry := []byte(`{
		"insertId": "vertex-2",
		"timestamp": "2026-07-01T09:30:00Z",
		"protoPayload": {
			"serviceName": "aiplatform.googleapis.com",
			"methodName": "google.cloud.aiplatform.v1.EndpointService.DeployModel",
			"resourceName": "projects/ernest-demo/locations/europe-west1/endpoints/endpoint-123",
			"request": {
				"deployedModel": {
					"id": "blue",
					"model": "projects/ernest-demo/locations/europe-west1/models/credit-risk-vertex"
				}
			}
		}
	}`)
	raw := []byte(`{
		"message": {
			"messageId": "pubsub-1",
			"data": "` + base64.StdEncoding.EncodeToString(logEntry) + `"
		},
		"subscription": "projects/ernest-demo/subscriptions/vertex-audit"
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "model.deployed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-vertex" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	metadata := got.Payload["metadata"].(map[string]any)
	if metadata["vertexPubSubMessageId"] != "pubsub-1" {
		t.Fatalf("pubsub message mismatch: %#v", metadata["vertexPubSubMessageId"])
	}
}

func TestAdaptWithoutIdentifyingFieldsHashesRawBodyForSourceEventID(t *testing.T) {
	rawA := []byte(`{"resource":{"labels":{"project_id":"ernest-demo"}}}`)
	rawB := []byte(`{"resource":{"labels":{"project_id":"ernest-demo-2"}}}`)

	payloadA := map[string]any{}
	if err := json.Unmarshal(rawA, &payloadA); err != nil {
		t.Fatal(err)
	}
	payloadB := map[string]any{}
	if err := json.Unmarshal(rawB, &payloadB); err != nil {
		t.Fatal(err)
	}

	gotA := Adapt(payloadA, rawA)
	gotB := Adapt(payloadB, rawB)

	if gotA.SourceEventID == "vertex:vertexai-unknown" {
		t.Fatalf("expected hash-based fallback sourceEventId, got the unreachable placeholder form: %s", gotA.SourceEventID)
	}
	if gotA.SourceEventID == gotB.SourceEventID {
		t.Fatalf("expected distinct payloads without insertId/methodName/resourceName to get distinct sourceEventIds, both got %s", gotA.SourceEventID)
	}
}
