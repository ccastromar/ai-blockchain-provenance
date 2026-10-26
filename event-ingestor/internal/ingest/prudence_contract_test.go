package ingest

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
)

// Ernest's side of Prudence's decision events contract over HTTP
// (../kafkasource/testdata/prudence-decision-events, synced from prudence-governance; its SOURCE
// sums are checked in kafkasource): every POST /events request Prudence sends with
// decision-transport=ingestor is accepted with the shared ingest key and read as the vectors say.

func TestPrudenceDecisionEventsOverHTTP(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "kafkasource", "testdata", "prudence-decision-events", "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		HTTP struct {
			IngestKey string `json:"ingestKey"`
		} `json:"http"`
		Cases []struct {
			Name string `json:"name"`
			HTTP struct {
				Method  string            `json:"method"`
				Path    string            `json:"path"`
				Headers map[string]string `json:"headers"`
				Body    json.RawMessage   `json:"body"`
			} `json:"http"`
			Ernest struct {
				Source          string         `json:"source"`
				EventType       string         `json:"eventType"`
				CanonicalType   string         `json:"canonicalType"`
				SourceEventID   string         `json:"sourceEventId"`
				EvidenceEventID string         `json:"evidenceEventId"`
				ModelID         string         `json:"modelId"`
				InferenceID     string         `json:"inferenceId"`
				InputHash       string         `json:"inputHash"`
				OutputHash      string         `json:"outputHash"`
				Metadata        map[string]any `json:"metadata"`
			} `json:"ernest"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no cases")
	}
	handler := NewHandler(nil, config.Config{IngestorAPIKey: doc.HTTP.IngestKey})
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			body := []byte(c.HTTP.Body)
			r := httptest.NewRequest(c.HTTP.Method, c.HTTP.Path, bytes.NewReader(body))
			for k, v := range c.HTTP.Headers {
				r.Header.Set(k, v)
			}
			status, ok := handler.verifyIngestAuth(r)
			if !ok || status != "shared_secret" {
				t.Fatalf("Prudence's ingest key is refused (%q, %v)", status, ok)
			}
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatal(err)
			}
			attachVerification(payload, status)
			got := events.Normalize(ingestedFromRequest(r, body, payload))
			want := c.Ernest
			for _, check := range [][3]string{
				{"source", got.Source, want.Source},
				{"metadata.eventType", stringFrom(got.Metadata, "eventType"), want.EventType},
				{"type", got.Type, want.CanonicalType},
				{"sourceEventId", got.SourceEventID, want.SourceEventID},
				{"evidenceEventId", hashchain.EvidenceEventID(got), want.EvidenceEventID},
				{"modelId", got.ModelID, want.ModelID},
				{"inferenceId", got.InferenceID, want.InferenceID},
				{"inputHash", got.InputHash, want.InputHash},
				{"outputHash", got.OutputHash, want.OutputHash},
				{"metadata.verificationStatus", stringFrom(got.Metadata, "verificationStatus"), "shared_secret"},
			} {
				if check[1] != check[2] {
					t.Errorf("%s = %q, want %q", check[0], check[1], check[2])
				}
			}
			for key, value := range want.Metadata {
				have, present := got.Metadata[key]
				if value == nil {
					if present {
						t.Errorf("metadata.%s = %v, must be absent", key, have)
					}
					continue
				}
				if have != value {
					t.Errorf("metadata.%s = %v, want %v", key, have, value)
				}
			}
		})
	}
	wrong := httptest.NewRequest("POST", "/events", nil)
	wrong.Header.Set("X-Ernest-Ingest-Key", "not-the-key")
	if _, ok := handler.verifyIngestAuth(wrong); ok {
		t.Error("a wrong ingest key is accepted")
	}
}
