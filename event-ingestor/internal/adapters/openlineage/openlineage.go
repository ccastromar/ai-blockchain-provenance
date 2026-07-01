package openlineage

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

type AdaptedEvent struct {
	Source        string
	EventType     string
	SourceEventID string
	Payload       map[string]any
}

func Adapt(payload map[string]any, rawBody []byte) AdaptedEvent {
	eventType := strings.ToUpper(firstString(payload, "eventType", "type"))
	eventTime := firstString(payload, "eventTime", "time")
	run := objectValue(payload, "run")
	job := objectValue(payload, "job")
	runFacets := objectValue(run, "facets")
	jobFacets := objectValue(job, "facets")

	runID := firstString(run, "runId", "runID", "id")
	jobNamespace := firstString(job, "namespace")
	jobName := firstString(job, "name")
	modelID := firstNonEmpty(
		nestedString(runFacets, "ernest", "modelId"),
		nestedString(jobFacets, "ernest", "modelId"),
		nestedString(runFacets, "mlflow", "runName"),
		jobName,
	)
	if modelID == "" {
		modelID = "openlineage-unknown"
	}

	sourceEventID := buildSourceEventID(runID, jobNamespace, jobName, eventType, rawBody)
	datasets := datasetSummaries(payload)
	metadata := map[string]any{
		"provider":                "openlineage",
		"openLineageEventType":    eventType,
		"openLineageRunId":        runID,
		"openLineageJobNamespace": jobNamespace,
		"openLineageJobName":      jobName,
		"openLineageRawEventHash": sha256Hex(rawBody),
		"datasets":                datasets,
		"inputDatasetCount":       len(arrayValue(payload, "inputs")),
		"outputDatasetCount":      len(arrayValue(payload, "outputs")),
	}

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     firstNonEmpty(nestedString(jobFacets, "ernest", "modelName"), modelID),
		"sourceEventId": sourceEventID,
		"provider":      "openlineage",
		"occurredAt":    eventTime,
		"metadata":      metadata,
	}

	if version := firstNonEmpty(nestedString(runFacets, "ernest", "version"), nestedString(jobFacets, "ernest", "version")); version != "" {
		normalized["version"] = version
	}
	if artifactHash := firstNonEmpty(nestedString(runFacets, "ernest", "artifactHash"), nestedString(jobFacets, "ernest", "artifactHash")); artifactHash != "" {
		normalized["artifactHash"] = artifactHash
	}
	if gitCommit := firstNonEmpty(nestedString(runFacets, "sourceCode", "gitCommit"), nestedString(jobFacets, "sourceCode", "gitCommit"), nestedString(runFacets, "ernest", "gitCommit")); gitCommit != "" {
		normalized["gitCommit"] = gitCommit
	}
	if metrics := objectValue(nestedObject(runFacets, "ernest"), "metrics"); len(metrics) > 0 {
		normalized["metrics"] = metrics
	}

	return AdaptedEvent{
		Source:        "openlineage",
		EventType:     mapEventType(eventType, datasets),
		SourceEventID: sourceEventID,
		Payload:       normalized,
	}
}

func mapEventType(eventType string, datasets []map[string]any) string {
	switch eventType {
	case "START":
		return "training.started"
	case "COMPLETE", "FAIL", "ABORT":
		return "training.completed"
	default:
		if len(datasets) > 0 {
			return "dataset.linked"
		}
		return "external_event"
	}
}

func datasetSummaries(payload map[string]any) []map[string]any {
	summaries := []map[string]any{}
	for _, direction := range []string{"inputs", "outputs"} {
		for _, item := range arrayValue(payload, direction) {
			dataset, ok := item.(map[string]any)
			if !ok {
				continue
			}
			name := firstString(dataset, "name")
			namespace := firstString(dataset, "namespace")
			facets := objectValue(dataset, "facets")
			summary := map[string]any{
				"direction": direction[:len(direction)-1],
				"name":      name,
				"namespace": namespace,
				"nameHash":  sha256Hex([]byte(namespace + "/" + name)),
			}
			for _, key := range []string{"version", "fingerprint", "hash", "uri"} {
				if value := firstNonEmpty(nestedString(facets, "version", key), nestedString(facets, "dataSource", key), nestedString(facets, "ernest", key)); value != "" {
					summary[key] = value
				}
			}
			summaries = append(summaries, summary)
		}
	}
	return summaries
}

func buildSourceEventID(runID string, jobNamespace string, jobName string, eventType string, rawBody []byte) string {
	parts := []string{"ol"}
	for _, value := range []string{runID, jobNamespace, jobName, eventType} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, strings.ReplaceAll(value, " ", "-"))
		}
	}
	if len(parts) == 1 {
		return "ol-" + sha256Hex(rawBody)
	}
	return strings.Join(parts, ":")
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
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	if items, ok := value.([]any); ok {
		return items
	}
	return nil
}

func nestedObject(payload map[string]any, keys ...string) map[string]any {
	current := payload
	for _, key := range keys {
		current = objectValue(current, key)
		if current == nil {
			return nil
		}
	}
	return current
}

func nestedString(payload map[string]any, keys ...string) string {
	if len(keys) == 0 {
		return ""
	}
	parent := nestedObject(payload, keys[:len(keys)-1]...)
	if parent == nil {
		return ""
	}
	return stringValue(parent, keys[len(keys)-1])
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
