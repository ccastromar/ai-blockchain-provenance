package hashchain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"cli-ernest/internal/hashcanon"
)

// buildChain produces a small, correctly linked chain using the shared canonicalization
// (itself pinned by testdata/hash-golden-vectors.json), so these tests exercise the
// verify pipeline end to end without a database.
func buildChain(t *testing.T) []map[string]any {
	t.Helper()
	datas := []map[string]any{
		{"type": "model_registration", "modelId": "genesis"},
		{"type": "model_registration", "modelId": "m1", "metrics": map[string]any{"roc_auc": 0.86}},
		{"type": "inference", "modelId": "m1", "note": "a<b>&c"},
	}

	var blocks []map[string]any
	previousHash := "0"
	for i, data := range datas {
		timestamp := int64(1700000000 + i)
		hash, err := hashcanon.CalculateBlockHash(int64(i), timestamp, data, previousHash)
		if err != nil {
			t.Fatal(err)
		}
		blocks = append(blocks, map[string]any{
			"index":        int64(i),
			"timestamp":    timestamp,
			"data":         data,
			"previousHash": previousHash,
			"hash":         hash,
		})
		previousHash = hash
	}
	return blocks
}

func writeExportFile(t *testing.T, blocks []map[string]any, wrap bool) string {
	t.Helper()
	var payload any = blocks
	if wrap {
		payload = map[string]any{"exportedAt": "2026-07-03T10:00:00Z", "totalBlocks": len(blocks), "blocks": blocks}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "chain.json")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func verifyAll(blocks []Block) error {
	for i := range blocks {
		if err := verifyBlock(blocks, i); err != nil {
			return err
		}
	}
	return nil
}

func TestVerifyFromExportBundleFile(t *testing.T) {
	path := writeExportFile(t, buildChain(t), true)
	results, err := loadBlocksFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyAll(MapResultsToBlocks(results)); err != nil {
		t.Fatalf("valid exported chain failed verification: %v", err)
	}
}

func TestVerifyFromBareArrayFile(t *testing.T) {
	path := writeExportFile(t, buildChain(t), false)
	results, err := loadBlocksFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyAll(MapResultsToBlocks(results)); err != nil {
		t.Fatalf("valid bare-array chain failed verification: %v", err)
	}
}

func TestVerifyDetectsTamperedExport(t *testing.T) {
	blocks := buildChain(t)
	blocks[1]["data"].(map[string]any)["metrics"].(map[string]any)["roc_auc"] = 0.99

	path := writeExportFile(t, blocks, true)
	results, err := loadBlocksFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyAll(MapResultsToBlocks(results)); err == nil {
		t.Fatal("tampered chain verified as valid")
	}
}

func TestVerifyDetectsBrokenLink(t *testing.T) {
	blocks := buildChain(t)
	blocks[2]["previousHash"] = fmt.Sprintf("%064d", 0)

	path := writeExportFile(t, blocks, true)
	results, err := loadBlocksFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyAll(MapResultsToBlocks(results)); err == nil {
		t.Fatal("chain with broken previousHash link verified as valid")
	}
}
