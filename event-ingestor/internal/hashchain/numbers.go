package hashchain

import (
	"encoding/json"
	"fmt"
	"strings"
)

const maxSafeInteger = int64(1) << 53 // 2^53: the largest integer float64/JS can hold exactly

// NormalizeNumbers rewrites every json.Number in the tree as float64 before the data is
// hashed and stored. This pins the at-rest representation to BSON doubles -- the one
// numeric type every verifier (NestJS, this writer, the CLI) reads back identically.
//
// Integers that do not round-trip through float64 (|n| > 2^53) are rejected instead of
// silently rounded: JavaScript verifiers would read a different value than a Go
// verifier, forking consensus on the block hash. Rejecting at ingest turns that silent
// fork into a loud, attributable event failure. Fractional values are passed through
// float64 as-is -- floats are inherently doubles end to end.
func NormalizeNumbers(value any) (any, error) {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			normalized, err := NormalizeNumbers(child)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", key, err)
			}
			out[key] = normalized
		}
		return out, nil
	case []any:
		out := make([]any, len(typed))
		for i, child := range typed {
			normalized, err := NormalizeNumbers(child)
			if err != nil {
				return nil, fmt.Errorf("[%d]: %w", i, err)
			}
			out[i] = normalized
		}
		return out, nil
	case json.Number:
		lexeme := typed.String()
		parsed, err := typed.Float64()
		if err != nil {
			return nil, fmt.Errorf("invalid number %q: %w", lexeme, err)
		}
		if isIntegralLexeme(lexeme) {
			integer, err := typed.Int64()
			if err != nil || integer > maxSafeInteger || integer < -maxSafeInteger || int64(parsed) != integer {
				return nil, fmt.Errorf("integer %s exceeds 2^53 and cannot be represented consistently across verifiers", lexeme)
			}
		}
		return parsed, nil
	default:
		return typed, nil
	}
}

func isIntegralLexeme(lexeme string) bool {
	return !strings.ContainsAny(lexeme, ".eE")
}
