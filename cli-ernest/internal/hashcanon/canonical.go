package hashcanon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// This file must produce byte-identical output to the NestJS backend's
// canonicalization (json-canonicalize's canonicalizeEx, RFC 8785 / JCS, plus
// Ernest's excluded keys). The contract is pinned by the shared golden vectors
// in testdata/hash-golden-vectors.json (see golden_test.go): if the two
// implementations ever disagree, blocks written by one side stop verifying on
// the other. Do not change serialization behavior here without regenerating
// consensus -- which is a chain-breaking event, not a refactor.

var excludedKeys = map[string]bool{
	"__v":       true,
	"_id":       true,
	"createdAt": true,
	"updatedAt": true,
	"hash":      true,
}

func CanonicalJSON(value any) (string, error) {
	var buf bytes.Buffer
	if err := writeCanonical(&buf, clean(value)); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func clean(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, child := range typed {
			if excludedKeys[key] {
				continue
			}
			out[key] = clean(child)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, child := range typed {
			out[i] = clean(child)
		}
		return out
	default:
		return typed
	}
}

func writeCanonical(buf *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		// RFC 8785 sorts keys by UTF-16 code units, which differs from Go's
		// native UTF-8 byte order for keys containing supplementary-plane
		// characters (e.g. emoji sort before U+FFFD in UTF-16, after it in
		// UTF-8).
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		buf.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			writeJSONString(buf, key)
			buf.WriteByte(':')
			if err := writeCanonical(buf, typed[key]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	case []any:
		buf.WriteByte('[')
		for i, child := range typed {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonical(buf, child); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
		return nil
	case json.Number:
		// Numbers are normalized, not preserved verbatim: JCS hashes the VALUE
		// ("1.50" and "1.5" are the same number), and Mongo stores a double
		// anyway, so verbatim lexemes would diverge from what verifiers read
		// back from the database.
		parsed, err := typed.Float64()
		if err != nil {
			return fmt.Errorf("canonicalize invalid number %q: %w", typed.String(), err)
		}
		return writeJSONNumber(buf, parsed)
	case string:
		writeJSONString(buf, typed)
		return nil
	case bool:
		if typed {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
		return nil
	case float64:
		return writeJSONNumber(buf, typed)
	case float32:
		return writeJSONNumber(buf, float64(typed))
	case int:
		buf.WriteString(strconv.FormatInt(int64(typed), 10))
		return nil
	case int32:
		buf.WriteString(strconv.FormatInt(int64(typed), 10))
		return nil
	case int64:
		buf.WriteString(strconv.FormatInt(typed, 10))
		return nil
	case nil:
		buf.WriteString("null")
		return nil
	default:
		return fmt.Errorf("canonicalize unsupported value type %T", typed)
	}
}

// writeJSONString mirrors ECMAScript JSON.stringify: short escapes for the
// common control characters, \u00XX for the rest below U+0020, everything else
// emitted literally -- including <, > and & (which encoding/json escapes by
// default) and U+2028/U+2029 (which are valid JSON).
func writeJSONString(buf *bytes.Buffer, value string) {
	buf.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			buf.WriteString(`\"`)
		case '\\':
			buf.WriteString(`\\`)
		case '\b':
			buf.WriteString(`\b`)
		case '\f':
			buf.WriteString(`\f`)
		case '\n':
			buf.WriteString(`\n`)
		case '\r':
			buf.WriteString(`\r`)
		case '\t':
			buf.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(buf, `\u%04x`, r)
			} else {
				buf.WriteRune(r)
			}
		}
	}
	buf.WriteByte('"')
}

// writeJSONNumber renders a float64 exactly like ECMAScript Number::toString
// (the serialization JCS mandates): shortest round-trip digits, plain decimal
// notation for magnitudes in [1e-6, 1e21), exponent notation outside it, and
// negative zero collapsed to "0".
func writeJSONNumber(buf *bytes.Buffer, f float64) error {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return fmt.Errorf("canonicalize non-finite number %v", f)
	}
	if f == 0 {
		buf.WriteByte('0')
		return nil
	}
	if f < 0 {
		buf.WriteByte('-')
		return writeJSONNumber(buf, -f)
	}

	// Shortest round-trip representation, decomposed into digits and exponent.
	mant := strconv.FormatFloat(f, 'e', -1, 64) // e.g. "1.2345e+06"
	ePos := strings.IndexByte(mant, 'e')
	exp, err := strconv.Atoi(mant[ePos+1:])
	if err != nil {
		return err
	}
	digits := strings.Replace(mant[:ePos], ".", "", 1)
	n := exp + 1 // position of the decimal point relative to the digits
	k := len(digits)

	switch {
	case k <= n && n <= 21:
		buf.WriteString(digits)
		buf.WriteString(strings.Repeat("0", n-k))
	case 0 < n && n <= 21:
		buf.WriteString(digits[:n])
		buf.WriteByte('.')
		buf.WriteString(digits[n:])
	case -6 < n && n <= 0:
		buf.WriteString("0.")
		buf.WriteString(strings.Repeat("0", -n))
		buf.WriteString(digits)
	default:
		buf.WriteString(digits[:1])
		if k > 1 {
			buf.WriteByte('.')
			buf.WriteString(digits[1:])
		}
		buf.WriteByte('e')
		if exp >= 0 {
			buf.WriteByte('+')
		}
		buf.WriteString(strconv.Itoa(exp))
	}
	return nil
}

// lessUTF16 compares strings by UTF-16 code units, the sort order RFC 8785
// requires for object keys.
func lessUTF16(a, b string) bool {
	ua := utf16.Encode([]rune(a))
	ub := utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}
