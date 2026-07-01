package huggingface

import (
	"encoding/json"
	"testing"
)

func TestAdaptModelRepoContentUpdate(t *testing.T) {
	raw := []byte(`{
		"event": {"action": "update", "scope": "repo.content"},
		"repo": {
			"type": "model",
			"name": "openai-community/gpt2",
			"headSha": "575db8b7a51b6f85eb06eee540738584589f131c",
			"url": {
				"web": "https://huggingface.co/openai-community/gpt2",
				"api": "https://huggingface.co/api/models/openai-community/gpt2"
			}
		},
		"webhook": {"id": "webhook-1"}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "huggingface" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.version.created" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "openai-community/gpt2" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "575db8b7a51b" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
	if got.Payload["gitCommit"] != "575db8b7a51b6f85eb06eee540738584589f131c" {
		t.Fatalf("gitCommit mismatch: %#v", got.Payload["gitCommit"])
	}
}

func TestAdaptModelDiscussionUpdate(t *testing.T) {
	raw := []byte(`{
		"event": {"action": "update", "scope": "discussion"},
		"repo": {"type": "model", "name": "org/model"},
		"webhook": {"id": "webhook-1"}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "model.card.updated" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
}
