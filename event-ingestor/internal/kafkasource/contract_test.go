package kafkasource

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"

	"github.com/twmb/franz-go/pkg/kgo"
)

// Ernest's side of AOS's audit events contract (testdata/aos-audit-events, copied from
// aos-agentic-orchestration-system contract/audit-events by its sync.sh): every Kafka record AOS
// publishes is read, normalized and identified as the vectors say.

const aosContract = "testdata/aos-audit-events"

func TestAOSAuditEventsContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(aosContract, "vectors.json"))
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
				Source          string         `json:"source"`
				EventType       string         `json:"eventType"`
				SourceEventID   string         `json:"sourceEventId"`
				EvidenceEventID string         `json:"evidenceEventId"`
				ModelID         string         `json:"modelId"`
				ModelName       string         `json:"modelName"`
				CanonicalType   string         `json:"canonicalType"`
				OccurredAt      string         `json:"occurredAt"`
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
			want := c.Ernest
			for _, check := range [][3]string{
				{"source", got.Source, want.Source},
				{"sourceEventId", got.SourceEventID, want.SourceEventID},
				{"evidenceEventId", hashchain.EvidenceEventID(got), want.EvidenceEventID},
				{"modelId", got.ModelID, want.ModelID},
				{"modelName", got.ModelName, want.ModelName},
				{"type", got.Type, want.CanonicalType},
				{"occurredAt", got.OccurredAt, want.OccurredAt},
				{"metadata.eventType", stringOf(got.Metadata["eventType"]), want.EventType},
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

// The copies are the ones synced from their owners; an edit made here fails this test.
func TestContractCopiesAreUnmodified(t *testing.T) {
	for _, dir := range []string{aosContract, prudenceDecisionContract} {
		t.Run(dir, func(t *testing.T) { checkSyncedCopy(t, dir) })
	}
}

func checkSyncedCopy(t *testing.T, dir string) {
	f, err := os.Open(filepath.Join(dir, "SOURCE"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	checked := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		sum, name, ok := strings.Cut(line, "  ")
		if !ok {
			t.Fatalf("bad SOURCE line %q", line)
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if got := sha256.Sum256(data); hex.EncodeToString(got[:]) != sum {
			t.Errorf("%s/%s differs from the synced copy: change the contract where it is owned and run its sync.sh", dir, name)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("SOURCE lists no files")
	}
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}
