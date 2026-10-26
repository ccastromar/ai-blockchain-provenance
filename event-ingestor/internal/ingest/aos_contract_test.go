package ingest

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"
)

// Ernest's side of AOS's audit events contract over HTTP (../kafkasource/testdata/aos-audit-events,
// synced from AOS; its SOURCE sums are checked in kafkasource): every POST /events request AOS
// sends is accepted with its provider signature and read as the vectors say.

func TestAOSAuditEventsOverHTTP(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "kafkasource", "testdata", "aos-audit-events", "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		HTTP struct {
			HMACSecret string `json:"hmacSecret"`
		} `json:"http"`
		Cases []struct {
			Name string `json:"name"`
			HTTP struct {
				Method  string            `json:"method"`
				Path    string            `json:"path"`
				Headers map[string]string `json:"headers"`
				Body    string            `json:"body"` // the exact bytes AOS signs
			} `json:"http"`
			Ernest struct {
				Source             string         `json:"source"`
				EventType          string         `json:"eventType"`
				SourceEventID      string         `json:"sourceEventId"`
				EvidenceEventID    string         `json:"evidenceEventId"`
				ModelID            string         `json:"modelId"`
				ModelName          string         `json:"modelName"`
				CanonicalType      string         `json:"canonicalType"`
				OccurredAt         string         `json:"occurredAt"`
				VerificationStatus string         `json:"verificationStatus"`
				Metadata           map[string]any `json:"metadata"`
			} `json:"ernestHttp"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no cases")
	}
	// The vectors are signed at a fixed time; the tolerance only has to cover it.
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: doc.HTTP.HMACSecret, ProviderHMACTolerance: 100 * 365 * 24 * time.Hour})
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			body := []byte(c.HTTP.Body)
			r := httptest.NewRequest(c.HTTP.Method, c.HTTP.Path, bytes.NewReader(body))
			for k, v := range c.HTTP.Headers {
				r.Header.Set(k, v)
			}
			if !handler.validProviderHMAC(r, body) {
				t.Fatal("AOS's provider signature is refused")
			}
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatal(err)
			}
			attachVerification(payload, "provider_hmac")
			got := events.Normalize(ingestedFromRequest(r, body, payload))
			want := c.Ernest
			for _, check := range [][3]string{
				{"source", got.Source, want.Source},
				{"metadata.eventType", stringFrom(got.Metadata, "eventType"), want.EventType},
				{"sourceEventId", got.SourceEventID, want.SourceEventID},
				{"evidenceEventId", hashchain.EvidenceEventID(got), want.EvidenceEventID},
				{"modelId", got.ModelID, want.ModelID},
				{"modelName", got.ModelName, want.ModelName},
				{"type", got.Type, want.CanonicalType},
				{"occurredAt", got.OccurredAt, want.OccurredAt},
				{"metadata.verificationStatus", stringFrom(got.Metadata, "verificationStatus"), want.VerificationStatus},
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
}
