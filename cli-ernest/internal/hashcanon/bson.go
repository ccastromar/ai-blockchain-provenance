package hashcanon

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// NormalizeBSON rewrites the named container types the Mongo driver produces
// (primitive.M, primitive.A) into the plain map[string]any / []any shapes the
// canonicalizer's type switch expects. Everything else passes through
// unchanged; scalar BSON types (string, bool, float64, int32, int64, nil) are
// already handled by writeCanonical.
func NormalizeBSON(value any) any {
	switch typed := value.(type) {
	case primitive.M:
		return NormalizeBSON(map[string]any(typed))
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			out[key] = NormalizeBSON(child)
		}
		return out
	case primitive.A:
		return NormalizeBSON([]any(typed))
	case []any:
		out := make([]any, len(typed))
		for i, child := range typed {
			out[i] = NormalizeBSON(child)
		}
		return out
	default:
		return typed
	}
}

// CalculateBlockHash recomputes a block hash exactly like the NestJS backend
// and the Go event-writer: sha256 over "index|timestamp|canonicalData|previousHash",
// where canonicalData follows the shared golden vectors in
// testdata/hash-golden-vectors.json.
func CalculateBlockHash(index int64, timestamp int64, data map[string]any, previousHash string) (string, error) {
	normalized, ok := NormalizeBSON(data).(map[string]any)
	if !ok {
		return "", fmt.Errorf("block data is not an object")
	}
	canonicalData, err := CanonicalJSON(normalized)
	if err != nil {
		return "", err
	}
	blockString := fmt.Sprintf("%d|%d|%s|%s", index, timestamp, canonicalData, previousHash)
	sum := sha256.Sum256([]byte(blockString))
	return hex.EncodeToString(sum[:]), nil
}
