package sigverify

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type fixture struct {
	KeyID           string `json:"keyId"`
	PublicKeyBase64 string `json:"publicKeyBase64"`
	Vectors         []struct {
		Name            string          `json:"name"`
		BlockData       json.RawMessage `json:"blockData"`
		PaeBase64       string          `json:"paeBase64"`
		SignatureBase64 string          `json:"signatureBase64"`
	} `json:"vectors"`
}

func load(t *testing.T) fixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "signed-submission-golden.json"))
	if err != nil {
		t.Fatalf("fixture missing (run scripts/generate-signed-submission-vector.cjs): %v", err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func decodeData(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestGoldenSignedBytesReproducePAE(t *testing.T) {
	f := load(t)
	for _, v := range f.Vectors {
		got, err := SignedBytes(decodeData(t, v.BlockData))
		if err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		if base64.StdEncoding.EncodeToString(got) != v.PaeBase64 {
			t.Fatalf("%s: PAE mismatch", v.Name)
		}
	}
}

func TestGoldenEnvelopesVerify(t *testing.T) {
	f := load(t)
	for _, v := range f.Vectors {
		data := decodeData(t, v.BlockData)
		envelope, found := FromBlockData(data)
		if !found {
			t.Fatalf("%s: no embedded envelope", v.Name)
		}
		if err := Verify(data, envelope); err != nil {
			t.Fatalf("%s: golden envelope must verify: %v", v.Name, err)
		}
	}
}

func TestTamperedDataFails(t *testing.T) {
	f := load(t)
	data := decodeData(t, f.Vectors[0].BlockData)
	envelope, _ := FromBlockData(data)
	data["modelId"] = "tampered"
	if err := Verify(data, envelope); err == nil {
		t.Fatal("tampered data must not verify")
	}
}

func TestKeyIDDerivation(t *testing.T) {
	f := load(t)
	raw, _ := base64.StdEncoding.DecodeString(f.PublicKeyBase64)
	if KeyID(raw) != f.KeyID {
		t.Fatalf("keyId mismatch: %s vs %s", KeyID(raw), f.KeyID)
	}
}
