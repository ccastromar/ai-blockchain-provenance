package hashchain

import "testing"

func TestCanonicalJSONSortsKeysAndExcludesMetadata(t *testing.T) {
	got, err := CanonicalJSON(map[string]any{
		"z":         "last",
		"_id":       "mongo-id",
		"hash":      "block-hash",
		"createdAt": "date",
		"a": map[string]any{
			"b": 2.0,
			"a": true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	want := `{"a":{"a":true,"b":2},"z":"last"}`
	if got != want {
		t.Fatalf("canonical json mismatch\nwant: %s\n got: %s", want, got)
	}
}

func TestCanonicalJSONPreservesNullValues(t *testing.T) {
	got, err := CanonicalJSON(map[string]any{
		"metadata": map[string]any{
			"comment":     nil,
			"updatedRefs": []any{"main", nil},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	want := `{"metadata":{"comment":null,"updatedRefs":["main",null]}}`
	if got != want {
		t.Fatalf("canonical json mismatch\nwant: %s\n got: %s", want, got)
	}
}

func TestCalculateHashUsesNestCompatibleBlockString(t *testing.T) {
	got, err := CalculateHash(Block{
		Index:     1,
		Timestamp: 1700000000,
		Data: map[string]any{
			"type":    "model_registration",
			"modelId": "credit-risk",
		},
		PreviousHash: "abc123",
	})
	if err != nil {
		t.Fatal(err)
	}

	want := "71abf560cad85ce344c51914e48f86261d39dbbc2aaac4c2b529a2abf8dd958c"
	if got != want {
		t.Fatalf("hash mismatch\nwant: %s\n got: %s", want, got)
	}
}
