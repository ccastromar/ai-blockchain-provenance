package hashcanon

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Same consensus suite as the backend (backend/test/hash-golden-vectors.test.js) and the
// event-writer (event-ingestor/internal/hashchain/golden_test.go): every vector must
// reproduce byte for byte, or this CLI would report tampering on valid chains (or bless
// tampered ones).

type goldenFixture struct {
	Vectors []goldenVector `json:"vectors"`
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

// toBSONShapes re-wraps decoded JSON containers as primitive.M / primitive.A, the named
// types the Mongo driver hands back at verify time, exercising NormalizeBSON the way the
// CLI actually hits it.
func toBSONShapes(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := primitive.M{}
		for key, child := range typed {
			out[key] = toBSONShapes(child)
		}
		return out
	case []any:
		out := make(primitive.A, len(typed))
		for i, child := range typed {
			out[i] = toBSONShapes(child)
		}
		return out
	default:
		return typed
	}
}

func TestGoldenVectorsBlockHash(t *testing.T) {
	fixture := loadGoldenFixture(t)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			decoder := json.NewDecoder(bytes.NewReader(vector.Block.Data))
			decoder.UseNumber()
			var data map[string]any
			if err := decoder.Decode(&data); err != nil {
				t.Fatal(err)
			}
			bsonShaped, ok := toBSONShapes(data).(primitive.M)
			if !ok {
				t.Fatal("vector data is not an object")
			}

			got, err := CalculateBlockHash(vector.Block.Index, vector.Block.Timestamp, map[string]any(bsonShaped), vector.Block.PreviousHash)
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.ExpectedHash {
				t.Fatalf("hash mismatch\nwant: %s\n got: %s", vector.ExpectedHash, got)
			}
		})
	}
}

// canonical.go must stay a byte-for-byte mirror of the event-writer's implementation
// (only the package clause differs). If this fails, someone edited one copy without the
// other: re-sync them and rerun the golden suite everywhere.
func TestCanonicalImplementationMatchesEventWriter(t *testing.T) {
	local, err := os.ReadFile("canonical.go")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "event-ingestor", "internal", "hashchain", "canonical.go"))
	if err != nil {
		t.Skipf("event-ingestor sources not available: %v", err)
	}

	normalize := func(content []byte) []byte {
		return bytes.Replace(content, []byte("package hashcanon"), []byte("package hashchain"), 1)
	}
	if !bytes.Equal(normalize(local), normalize(source)) {
		t.Fatal("cli-ernest/internal/hashcanon/canonical.go has drifted from event-ingestor/internal/hashchain/canonical.go")
	}
}
