package sigverify

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// ADR-002 B2: the Go CLI must reproduce and verify the qualified-seal golden fixture in
// lockstep with the backend and the Rust/WASM verifier.

type qsealFixture struct {
	KeyID          string `json:"keyId"`
	LeafCertBase64 string `json:"leafCertBase64"`
	Vectors        []struct {
		Name            string          `json:"name"`
		BlockData       json.RawMessage `json:"blockData"`
		PaeBase64       string          `json:"paeBase64"`
		SignatureBase64 string          `json:"signatureBase64"`
	} `json:"vectors"`
}

func loadQseal(t *testing.T) qsealFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "qualified-seal-golden.json"))
	if err != nil {
		t.Fatalf("fixture missing (run scripts/generate-qualified-seal-vector.cjs): %v", err)
	}
	var f qsealFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func qsealData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestQsealGoldenSignedBytesReproducePAE(t *testing.T) {
	f := loadQseal(t)
	for _, v := range f.Vectors {
		got, err := SignedBytes(qsealData(t, v.BlockData))
		if err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		if base64.StdEncoding.EncodeToString(got) != v.PaeBase64 {
			t.Fatalf("%s: PAE mismatch", v.Name)
		}
	}
}

func TestQsealGoldenSealsVerify(t *testing.T) {
	f := loadQseal(t)
	for _, v := range f.Vectors {
		data := qsealData(t, v.BlockData)
		envelope, found := FromBlockData(data)
		if !found {
			t.Fatalf("%s: no embedded envelope", v.Name)
		}
		if envelope.Alg != "qeseal-ecdsa-p256" {
			t.Fatalf("%s: expected qeseal-ecdsa-p256, got %q", v.Name, envelope.Alg)
		}
		if envelope.KeyID != f.KeyID {
			t.Fatalf("%s: keyId %q != fixture %q", v.Name, envelope.KeyID, f.KeyID)
		}
		if err := Verify(data, envelope); err != nil {
			t.Fatalf("%s: golden seal must verify: %v", v.Name, err)
		}
	}
}

func TestQsealKeyIDIsLeafFingerprint(t *testing.T) {
	f := loadQseal(t)
	leafDER, err := base64.StdEncoding.DecodeString(f.LeafCertBase64)
	if err != nil {
		t.Fatal(err)
	}
	if KeyID(leafDER) != f.KeyID {
		t.Fatalf("keyId mismatch: %s vs %s", KeyID(leafDER), f.KeyID)
	}
}

func TestQsealTamperedDataFails(t *testing.T) {
	f := loadQseal(t)
	data := qsealData(t, f.Vectors[0].BlockData)
	envelope, _ := FromBlockData(data)
	data["modelId"] = "tampered"
	if err := Verify(data, envelope); err == nil {
		t.Fatal("tampered data must not verify")
	}
}
