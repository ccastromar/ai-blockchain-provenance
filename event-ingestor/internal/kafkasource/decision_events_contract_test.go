package kafkasource

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"

	"github.com/twmb/franz-go/pkg/kgo"
)

// Ernest's side of Prudence's decision events contract (testdata/prudence-decision-events,
// copied from prudence-governance contract/decision-events by its sync.sh): every decision record
// Prudence publishes is read, normalized and identified as the vectors say.

const prudenceDecisionContract = "testdata/prudence-decision-events"

func TestPrudenceDecisionEventsContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(prudenceDecisionContract, "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Cases []struct {
			Name   string `json:"name"`
			Record struct {
				Key     string            `json:"key"`
				Headers map[string]string `json:"headers"`
				Value   json.RawMessage   `json:"value"`
			} `json:"record"`
			Ernest struct {
				Source          string `json:"source"`
				EventType       string `json:"eventType"`
				CanonicalType   string `json:"canonicalType"`
				SourceEventID   string `json:"sourceEventId"`
				EvidenceEventID string `json:"evidenceEventId"`
				ModelID         string `json:"modelId"`
				ModelName       string `json:"modelName"`
				InferenceID     string `json:"inferenceId"`
				InputHash       string `json:"inputHash"`
				OutputHash      string `json:"outputHash"`
				AISystem        struct {
					ID             string `json:"id"`
					Name           string `json:"name"`
					RiskTier       string `json:"riskTier"`
					SystemOfRecord string `json:"systemOfRecord"`
				} `json:"aiSystem"`
				Metadata map[string]any `json:"metadata"`
			} `json:"ernest"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			rec := &kgo.Record{Key: []byte(c.Record.Key), Value: c.Record.Value}
			for k, v := range c.Record.Headers {
				rec.Headers = append(rec.Headers, kgo.RecordHeader{Key: k, Value: []byte(v)})
			}
			ingested, err := ingestedEvent(rec, UnverifiedStatus)
			if err != nil {
				t.Fatal(err)
			}
			got := events.Normalize(ingested)
			ai := events.AISystemOf(ingested.Payload)
			want := c.Ernest
			for _, check := range [][3]string{
				{"source", got.Source, want.Source},
				{"metadata.eventType", stringOf(got.Metadata["eventType"]), want.EventType},
				{"type", got.Type, want.CanonicalType},
				{"sourceEventId", got.SourceEventID, want.SourceEventID},
				{"evidenceEventId", hashchain.EvidenceEventID(got), want.EvidenceEventID},
				{"modelId", got.ModelID, want.ModelID},
				{"modelName", got.ModelName, want.ModelName},
				{"inferenceId", got.InferenceID, want.InferenceID},
				{"inputHash", got.InputHash, want.InputHash},
				{"outputHash", got.OutputHash, want.OutputHash},
				{"aiSystem.id", ai.ID, want.AISystem.ID},
				{"aiSystem.name", ai.Name, want.AISystem.Name},
				{"aiSystem.riskTier", ai.RiskTier, want.AISystem.RiskTier},
				{"aiSystem.systemOfRecord", ai.SystemOfRecord, want.AISystem.SystemOfRecord},
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
