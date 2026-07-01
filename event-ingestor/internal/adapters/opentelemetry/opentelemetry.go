package opentelemetry

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type AdaptedEvent struct {
	Source        string
	EventType     string
	SourceEventID string
	Payload       map[string]any
}

type logRecord struct {
	Attributes map[string]any
	Body       string
	Time       string
	TraceID    string
	SpanID     string
	Index      int
}

func AdaptAll(payload map[string]any, rawBody []byte) []AdaptedEvent {
	records := extractLogRecords(payload)
	if len(records) == 0 {
		records = []logRecord{{
			Attributes: attrsFromSimpleObject(payload),
			Body:       stringValue(payload, "body"),
			Time:       firstString(payload, "time", "timestamp", "observedTime"),
			TraceID:    stringValue(payload, "traceId"),
			SpanID:     stringValue(payload, "spanId"),
		}}
	}

	events := make([]AdaptedEvent, 0, len(records))
	for _, record := range records {
		events = append(events, adaptRecord(record, rawBody))
	}
	return events
}

func adaptRecord(record logRecord, rawBody []byte) AdaptedEvent {
	attrs := record.Attributes
	modelID := firstAttr(attrs, "ai.model.id", "model.id", "llm.model.id", "gen_ai.request.model", "gen_ai.response.model")
	if modelID == "" {
		modelID = "opentelemetry-unknown"
	}
	inferenceID := firstAttr(attrs, "ai.inference.id", "inference.id", "ai.request.id", "request.id", "http.request_id")
	if inferenceID == "" {
		inferenceID = firstNonEmpty(record.TraceID, sha256Hex([]byte(fmt.Sprintf("%s:%d", sha256Hex(rawBody), record.Index))))
	}

	inputHash := firstAttr(attrs, "ai.input.hash", "input.hash", "prompt.hash")
	outputHash := firstAttr(attrs, "ai.output.hash", "output.hash", "completion.hash", "response.hash")
	sourceEventID := buildSourceEventID(inferenceID, record.TraceID, record.SpanID, record.Index)
	metadata := map[string]any{
		"provider":             "opentelemetry",
		"otelRawEventHash":     sha256Hex(rawBody),
		"otelTraceId":          record.TraceID,
		"otelSpanId":           record.SpanID,
		"otelBody":             record.Body,
		"otelLogIndex":         record.Index,
		"aiProvider":           firstAttr(attrs, "ai.provider", "gen_ai.system", "llm.provider"),
		"aiRequestId":          firstAttr(attrs, "ai.request.id", "request.id", "http.request_id"),
		"aiOperation":          firstAttr(attrs, "ai.operation", "gen_ai.operation.name"),
		"selectedAttributes":   selectedAttributes(attrs),
		"hasInputHash":         inputHash != "",
		"hasOutputHash":        outputHash != "",
		"normalizationWarning": missingHashWarning(inputHash, outputHash),
	}

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     firstNonEmpty(firstAttr(attrs, "ai.model.name", "model.name"), modelID),
		"inferenceId":   inferenceID,
		"inputHash":     inputHash,
		"outputHash":    outputHash,
		"sourceEventId": sourceEventID,
		"provider":      "opentelemetry",
		"occurredAt":    firstNonEmpty(record.Time, firstAttr(attrs, "time", "timestamp")),
		"metadata":      metadata,
	}

	if version := firstAttr(attrs, "ai.model.version", "model.version"); version != "" {
		normalized["version"] = version
	}

	return AdaptedEvent{
		Source:        "opentelemetry",
		EventType:     "inference.logged",
		SourceEventID: sourceEventID,
		Payload:       normalized,
	}
}

func extractLogRecords(payload map[string]any) []logRecord {
	records := []logRecord{}
	for _, resourceLogItem := range arrayValue(payload, "resourceLogs") {
		resourceLog, ok := resourceLogItem.(map[string]any)
		if !ok {
			continue
		}
		resourceAttrs := attributesFromContainer(objectValue(resourceLog, "resource"))
		for _, scopeLogItem := range arrayValue(resourceLog, "scopeLogs") {
			scopeLog, ok := scopeLogItem.(map[string]any)
			if !ok {
				continue
			}
			for _, recordItem := range arrayValue(scopeLog, "logRecords") {
				recordObject, ok := recordItem.(map[string]any)
				if !ok {
					continue
				}
				attrs := copyMap(resourceAttrs)
				for key, value := range attributesFromContainer(recordObject) {
					attrs[key] = value
				}
				records = append(records, logRecord{
					Attributes: attrs,
					Body:       anyValueToString(recordObject["body"]),
					Time:       firstNonEmpty(otlpTime(recordObject["timeUnixNano"]), otlpTime(recordObject["observedTimeUnixNano"])),
					TraceID:    stringValue(recordObject, "traceId"),
					SpanID:     stringValue(recordObject, "spanId"),
					Index:      len(records),
				})
			}
		}
	}

	for _, item := range arrayValue(payload, "logs") {
		recordObject, ok := item.(map[string]any)
		if !ok {
			continue
		}
		records = append(records, logRecord{
			Attributes: attrsFromSimpleObject(recordObject),
			Body:       stringValue(recordObject, "body"),
			Time:       firstString(recordObject, "time", "timestamp"),
			TraceID:    stringValue(recordObject, "traceId"),
			SpanID:     stringValue(recordObject, "spanId"),
			Index:      len(records),
		})
	}

	return records
}

func attributesFromContainer(container map[string]any) map[string]any {
	attrs := map[string]any{}
	for _, item := range arrayValue(container, "attributes") {
		attr, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key := stringValue(attr, "key")
		if key == "" {
			continue
		}
		attrs[key] = anyValue(attr["value"])
	}
	return attrs
}

func attrsFromSimpleObject(payload map[string]any) map[string]any {
	attrs := map[string]any{}
	if nested := objectValue(payload, "attributes"); nested != nil {
		for key, value := range nested {
			attrs[key] = value
		}
	}
	for key, value := range payload {
		if strings.Contains(key, ".") {
			attrs[key] = value
		}
	}
	return attrs
}

func anyValue(value any) any {
	object, ok := value.(map[string]any)
	if !ok {
		return value
	}
	for _, key := range []string{"stringValue", "intValue", "doubleValue", "boolValue"} {
		if nested, ok := object[key]; ok {
			return nested
		}
	}
	return value
}

func anyValueToString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(anyValue(value))
}

func selectedAttributes(attrs map[string]any) map[string]any {
	selected := map[string]any{}
	for key, value := range attrs {
		if strings.HasPrefix(key, "ai.") || strings.HasPrefix(key, "gen_ai.") || strings.HasPrefix(key, "llm.") {
			selected[key] = value
		}
	}
	return selected
}

func missingHashWarning(inputHash string, outputHash string) string {
	if inputHash == "" && outputHash == "" {
		return "missing input/output hashes"
	}
	if inputHash == "" {
		return "missing input hash"
	}
	if outputHash == "" {
		return "missing output hash"
	}
	return ""
}

func buildSourceEventID(inferenceID string, traceID string, spanID string, index int) string {
	parts := []string{"otel"}
	for _, value := range []string{inferenceID, traceID, spanID} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, strings.ReplaceAll(value, " ", "-"))
		}
	}
	parts = append(parts, strconv.Itoa(index))
	return strings.Join(parts, ":")
}

func otlpTime(value any) string {
	if value == nil {
		return ""
	}
	raw := strings.TrimSpace(fmt.Sprint(value))
	if raw == "" {
		return ""
	}
	nanos, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || nanos <= 0 {
		return ""
	}
	return time.Unix(0, nanos).UTC().Format(time.RFC3339Nano)
}

func objectValue(payload map[string]any, key string) map[string]any {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return nil
}

func arrayValue(payload map[string]any, key string) []any {
	if payload == nil {
		return nil
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	if items, ok := value.([]any); ok {
		return items
	}
	return nil
}

func firstAttr(attrs map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := attrs[key]; ok && value != nil {
			return fmt.Sprint(value)
		}
	}
	return ""
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(payload, key); value != "" {
			return value
		}
	}
	return ""
}

func stringValue(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

func copyMap(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func sha256Hex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
