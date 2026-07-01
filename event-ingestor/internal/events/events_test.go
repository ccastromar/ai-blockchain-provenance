package events

import "testing"

func TestNormalizeModelVersionCreated(t *testing.T) {
	event := IngestedEvent{
		Source:        "random-local-emitter",
		EventType:     "model.version.created",
		SourceEventID: "evt-1",
		RawEventHash:  "raw-hash",
		Payload: map[string]any{
			"modelId":      "credit-risk",
			"modelName":    "Credit Risk",
			"version":      "3",
			"artifactHash": "artifact-hash",
			"gitCommit":    "abcdef1",
			"metrics": map[string]any{
				"accuracy": 0.9,
			},
		},
	}

	got := Normalize(event)
	if got.Type != "model_registration" {
		t.Fatalf("type mismatch: %s", got.Type)
	}
	if got.ModelID != "credit-risk" || got.ModelName != "Credit Risk" || got.Version != "3" {
		t.Fatalf("unexpected model fields: %#v", got)
	}
	if got.ModelHash != "artifact-hash" || got.GitCommit != "abcdef1" {
		t.Fatalf("unexpected evidence fields: %#v", got)
	}
	if got.Metadata["eventType"] != "model.version.created" {
		t.Fatalf("eventType metadata missing: %#v", got.Metadata)
	}
}

func TestNormalizeInferenceLogged(t *testing.T) {
	event := IngestedEvent{
		Source:        "otel",
		EventType:     "inference.logged",
		SourceEventID: "span-1",
		RawEventHash:  "raw-hash",
		Payload: map[string]any{
			"modelId":    "credit-risk",
			"inputHash":  "input-hash",
			"outputHash": "output-hash",
		},
	}

	got := Normalize(event)
	if got.Type != "inference" {
		t.Fatalf("type mismatch: %s", got.Type)
	}
	if got.InferenceID != "span-1" {
		t.Fatalf("expected source event id fallback, got %s", got.InferenceID)
	}
	if got.InputHash != "input-hash" || got.OutputHash != "output-hash" {
		t.Fatalf("unexpected inference hashes: %#v", got)
	}
}

func TestNormalizeUnknownExternalEvent(t *testing.T) {
	got := Normalize(IngestedEvent{
		Source:        "unknown",
		EventType:     "custom.event",
		SourceEventID: "evt-1",
		Payload:       map[string]any{},
	})

	if got.Type != "external_event" {
		t.Fatalf("type mismatch: %s", got.Type)
	}
	if got.ModelID != "external-unknown" {
		t.Fatalf("model id fallback mismatch: %s", got.ModelID)
	}
}
