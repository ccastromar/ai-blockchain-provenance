package merkleproof

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Cross-language fixture generated from the backend's merkletreejs construction
// (scripts/generate-merkle-proof-vector.cjs). Every proof must verify here, or
// receipts issued by the API would fail offline verification in this CLI.

type goldenFixture struct {
	Cases []struct {
		Name        string   `json:"name"`
		BlockHashes []string `json:"blockHashes"`
		MerkleRoot  string   `json:"merkleRoot"`
		Proofs      []struct {
			BlockIndex int64    `json:"blockIndex"`
			BlockHash  string   `json:"blockHash"`
			Proof      []string `json:"proof"`
		} `json:"proofs"`
	} `json:"cases"`
}

func loadFixture(t *testing.T) goldenFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "merkle-proof-golden.json"))
	if err != nil {
		t.Fatalf("golden fixture not found (run scripts/generate-merkle-proof-vector.cjs): %v", err)
	}
	var fixture goldenFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("fixture contains no cases")
	}
	return fixture
}

func TestGoldenProofsVerify(t *testing.T) {
	for _, c := range loadFixture(t).Cases {
		t.Run(c.Name, func(t *testing.T) {
			for _, p := range c.Proofs {
				ok, err := Verify(p.BlockHash, p.Proof, c.MerkleRoot)
				if err != nil {
					t.Fatal(err)
				}
				if !ok {
					t.Fatalf("proof for block %d must verify against %s", p.BlockIndex, c.MerkleRoot)
				}
			}
		})
	}
}

func TestTamperedLeafFailsVerification(t *testing.T) {
	fixture := loadFixture(t)
	for _, c := range fixture.Cases {
		for _, p := range c.Proofs {
			if len(p.Proof) == 0 {
				continue // single-leaf case: any other leaf trivially differs from the root
			}
			tampered := "f" + p.BlockHash[1:]
			if p.BlockHash[0] == 'f' {
				tampered = "0" + p.BlockHash[1:]
			}
			ok, err := Verify(tampered, p.Proof, c.MerkleRoot)
			if err != nil {
				t.Fatal(err)
			}
			if ok {
				t.Fatalf("case %s block %d: tampered leaf must not verify", c.Name, p.BlockIndex)
			}
		}
	}
}

func TestWrongRootFailsVerification(t *testing.T) {
	fixture := loadFixture(t)
	c := fixture.Cases[len(fixture.Cases)-1]
	p := c.Proofs[0]
	ok, err := Verify(p.BlockHash, p.Proof, "0x"+strings.Repeat("00", 32))
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("verification against a wrong root must fail")
	}
}

func TestSingleLeafRootEqualsLeaf(t *testing.T) {
	for _, c := range loadFixture(t).Cases {
		if c.Name != "single-leaf" {
			continue
		}
		ok, err := Verify(c.Proofs[0].BlockHash, nil, c.MerkleRoot)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Fatal("single-leaf tree: root must equal the leaf with an empty proof")
		}
	}
}
