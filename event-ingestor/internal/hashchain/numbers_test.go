package hashchain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeNumbersConvertsToFloat64(t *testing.T) {
	got, err := NormalizeNumbers(map[string]any{
		"score":   json.Number("0.8642"),
		"count":   json.Number("42"),
		"big":     json.Number("9007199254740992"), // exactly 2^53: still round-trips
		"exp":     json.Number("1.5e3"),
		"nested":  map[string]any{"v": json.Number("-7")},
		"list":    []any{json.Number("1"), "text", nil, true},
		"literal": "unchanged",
	})
	if err != nil {
		t.Fatal(err)
	}

	data := got.(map[string]any)
	if v, ok := data["score"].(float64); !ok || v != 0.8642 {
		t.Fatalf("score not normalized to float64: %#v", data["score"])
	}
	if v, ok := data["big"].(float64); !ok || int64(v) != maxSafeInteger {
		t.Fatalf("2^53 should be accepted: %#v", data["big"])
	}
	if v, ok := data["nested"].(map[string]any)["v"].(float64); !ok || v != -7 {
		t.Fatalf("nested number not normalized: %#v", data["nested"])
	}
	if v, ok := data["list"].([]any)[0].(float64); !ok || v != 1 {
		t.Fatalf("list number not normalized: %#v", data["list"])
	}
}

func TestNormalizeNumbersRejectsIntegersBeyond2p53(t *testing.T) {
	cases := []string{
		"9007199254740993",        // 2^53 + 1: rounds silently in float64
		"-9007199254740993",       // negative counterpart
		"98765432109876543212345", // beyond int64 entirely
	}
	for _, lexeme := range cases {
		_, err := NormalizeNumbers(map[string]any{"metadata": map[string]any{"id": json.Number(lexeme)}})
		if err == nil {
			t.Fatalf("expected rejection for %s", lexeme)
		}
		if !strings.Contains(err.Error(), "metadata") {
			t.Fatalf("error should carry the field path, got: %v", err)
		}
	}
}

func TestNormalizeNumbersAllowsLargeFractionalValues(t *testing.T) {
	// Floats are inherently doubles end to end -- magnitude alone is not an error.
	got, err := NormalizeNumbers(map[string]any{"v": json.Number("1.7976931348623157e308")})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got.(map[string]any)["v"].(float64); !ok {
		t.Fatalf("large float rejected: %#v", got)
	}
}
