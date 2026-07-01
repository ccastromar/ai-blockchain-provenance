package cloudevents

import (
	"encoding/json"
	"testing"
)

func TestAdaptValidCloudEvent(t *testing.T) {
	raw := []byte(`{
		"specversion": "1.0",
		"id": "ce-1",
		"source": "urn:ernest:e2e",
		"type": "com.ernest.model.registered",
		"time": "2026-07-01T09:00:00Z",
		"subject": "models/credit-risk-ce",
		"datacontenttype": "application/json",
		"data": {
			"eventType": "model.registered",
			"modelId": "credit-risk-ce",
			"version": "4",
			"artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got, err := Adapt(payload, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Source != "cloudevents" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.registered" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.SourceEventID != "ce-1" {
		t.Fatalf("source event ID mismatch: %s", got.SourceEventID)
	}
	if got.Payload["modelId"] != "credit-risk-ce" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["artifactHash"] == "" {
		t.Fatalf("expected artifact hash in payload")
	}
}

func TestAdaptMapsCloudTypeWhenDataEventTypeMissing(t *testing.T) {
	raw := []byte(`{
		"specversion": "1.0",
		"id": "ce-2",
		"source": "urn:ernest:e2e",
		"type": "com.ernest.inference.logged",
		"subject": "models/credit-risk-ce",
		"data": {
			"modelId": "credit-risk-ce",
			"inferenceId": "inf-1",
			"inputHash": "input",
			"outputHash": "output"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got, err := Adapt(payload, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.EventType != "inference.logged" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["inferenceId"] != "inf-1" {
		t.Fatalf("inferenceId mismatch: %#v", got.Payload["inferenceId"])
	}
}

func TestAdaptRejectsInvalidEnvelope(t *testing.T) {
	raw := []byte(`{
		"specversion": "0.3",
		"id": "ce-3",
		"source": "urn:ernest:e2e",
		"type": "com.ernest.model.registered"
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	if _, err := Adapt(payload, raw); err == nil {
		t.Fatal("expected invalid specversion to fail")
	}
}
