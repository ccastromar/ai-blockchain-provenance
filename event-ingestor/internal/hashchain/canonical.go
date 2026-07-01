package hashchain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

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
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			keyJSON, _ := json.Marshal(key)
			buf.Write(keyJSON)
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
		buf.WriteString(typed.String())
		return nil
	case string:
		encoded, _ := json.Marshal(typed)
		buf.Write(encoded)
		return nil
	case bool:
		if typed {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
		return nil
	case float64:
		buf.WriteString(strconv.FormatFloat(typed, 'f', -1, 64))
		return nil
	case nil:
		buf.WriteString("null")
		return nil
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Errorf("canonicalize unsupported value: %w", err)
		}
		buf.Write(encoded)
		return nil
	}
}
