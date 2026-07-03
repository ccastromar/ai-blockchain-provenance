package hashchain

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// Consensus suite shared with the NestJS backend (backend/test/hash-golden-vectors.test.js)
// and the Go CLI. The fixture is generated from the reference implementation
// (json-canonicalize, RFC 8785) by scripts/generate-hash-golden-vectors.cjs; this side
// must reproduce every canonical string and hash byte for byte or blocks written by one
// process stop verifying on the other.

type goldenFixture struct {
	ExcludedKeys []string       `json:"excludedKeys"`
	Vectors      []goldenVector `json:"vectors"`
}

type goldenVector struct {
	Name                  string      `json:"name"`
	Block                 goldenBlock `json:"block"`
	ExpectedCanonicalData string      `json:"expectedCanonicalData"`
	ExpectedHash          string      `json:"expectedHash"`
}

type goldenBlock struct {
	Index        int64           `json:"index"`
	Timestamp    int64           `json:"timestamp"`
	PreviousHash string          `json:"previousHash"`
	Data         json.RawMessage `json:"data"`
}

func loadGoldenFixture(t *testing.T) goldenFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "hash-golden-vectors.json"))
	if err != nil {
		t.Fatalf("golden fixture not found (run scripts/generate-hash-golden-vectors.cjs): %v", err)
	}
	var fixture goldenFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("golden fixture unreadable: %v", err)
	}
	if len(fixture.Vectors) == 0 {
		t.Fatal("golden fixture contains no vectors")
	}
	return fixture
}

// decodeData mirrors how AppendEvent materializes event data before hashing:
// json.Decoder with UseNumber, so numeric lexemes arrive as json.Number.
func decodeData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		t.Fatalf("cannot decode vector data: %v", err)
	}
	return data
}

func TestGoldenVectorsCanonicalData(t *testing.T) {
	fixture := loadGoldenFixture(t)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			got, err := CanonicalJSON(decodeData(t, vector.Block.Data))
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.ExpectedCanonicalData {
				t.Fatalf("canonical data mismatch\nwant: %s\n got: %s", vector.ExpectedCanonicalData, got)
			}
		})
	}
}

func TestGoldenVectorsBlockHash(t *testing.T) {
	fixture := loadGoldenFixture(t)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			got, err := CalculateHash(Block{
				Index:        vector.Block.Index,
				Timestamp:    vector.Block.Timestamp,
				Data:         decodeData(t, vector.Block.Data),
				PreviousHash: vector.Block.PreviousHash,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.ExpectedHash {
				t.Fatalf("hash mismatch\nwant: %s\n got: %s", vector.ExpectedHash, got)
			}
		})
	}
}

// Negative zero cannot be represented in the JSON fixture (JSON.stringify(-0) emits
// "0"), so it is pinned here directly, matching canonicalizeEx({a:-0}) === {"a":0}.
func TestGoldenNegativeZero(t *testing.T) {
	got, err := CanonicalJSON(map[string]any{"a": math.Copysign(0, -1)})
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"a":0}` {
		t.Fatalf(`want {"a":0}, got %s`, got)
	}
}
