package cloudevents

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

type AdaptedEvent struct {
	Source        string
	EventType     string
	SourceEventID string
	Payload       map[string]any
}

func Adapt(payload map[string]any, rawBody []byte) (AdaptedEvent, error) {
	specVersion := stringValue(payload, "specversion")
	id := stringValue(payload, "id")
	source := stringValue(payload, "source")
	cloudType := stringValue(payload, "type")
	if specVersion != "1.0" {
		return AdaptedEvent{}, errors.New("CloudEvents specversion must be 1.0")
	}
	if strings.TrimSpace(id) == "" {
		return AdaptedEvent{}, errors.New("CloudEvents id is required")
	}
	if strings.TrimSpace(source) == "" {
		return AdaptedEvent{}, errors.New("CloudEvents source is required")
	}
	if strings.TrimSpace(cloudType) == "" {
		return AdaptedEvent{}, errors.New("CloudEvents type is required")
	}

	data := objectValue(payload, "data")
	eventType := firstNonEmpty(firstString(data, "eventType", "type"), mapCloudType(cloudType))
	modelID := firstNonEmpty(firstString(data, "modelId", "model_id"), subjectName(stringValue(payload, "subject")), "cloudevent-unknown")
	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     firstNonEmpty(firstString(data, "modelName", "model_name", "name"), modelID),
		"sourceEventId": id,
		"provider":      "cloudevents",
		"occurredAt":    firstNonEmpty(stringValue(payload, "time"), firstString(data, "occurredAt", "time")),
		"metadata": map[string]any{
			"provider":                "cloudevents",
			"cloudEventsId":           id,
			"cloudEventsSource":       source,
			"cloudEventsType":         cloudType,
			"cloudEventsSubject":      stringValue(payload, "subject"),
			"cloudEventsDataSchema":   stringValue(payload, "dataschema"),
			"cloudEventsContentType":  stringValue(payload, "datacontenttype"),
			"cloudEventsRawEventHash": sha256Hex(rawBody),
		},
	}

	for _, key := range []string{"version", "modelVersion", "model_version"} {
		if value := stringValue(data, key); value != "" {
			normalized["version"] = value
			break
		}
	}
	if artifactHash := firstString(data, "artifactHash", "artifact_hash", "modelHash", "model_hash"); artifactHash != "" {
		normalized["artifactHash"] = artifactHash
	}
	if artifactURI := firstString(data, "artifactUri", "artifact_uri", "modelUri", "model_uri"); artifactURI != "" {
		normalized["artifactUri"] = artifactURI
	}
	if gitCommit := firstString(data, "gitCommit", "git_commit", "commit", "sha"); gitCommit != "" {
		normalized["gitCommit"] = gitCommit
	}
	if inferenceID := firstString(data, "inferenceId", "inference_id"); inferenceID != "" {
		normalized["inferenceId"] = inferenceID
	}
	if inputHash := firstString(data, "inputHash", "input_hash"); inputHash != "" {
		normalized["inputHash"] = inputHash
	}
	if outputHash := firstString(data, "outputHash", "output_hash"); outputHash != "" {
		normalized["outputHash"] = outputHash
	}
	if params := objectValue(data, "params"); len(params) > 0 {
		normalized["params"] = params
	}
	if metrics := objectValue(data, "metrics"); len(metrics) > 0 {
		normalized["metrics"] = metrics
	}

	return AdaptedEvent{
		Source:        "cloudevents",
		EventType:     eventType,
		SourceEventID: id,
		Payload:       normalized,
	}, nil
}

func mapCloudType(cloudType string) string {
	lower := strings.ToLower(cloudType)
	switch {
	case strings.Contains(lower, "model.registered"):
		return "model.registered"
	case strings.Contains(lower, "model.version.created"):
		return "model.version.created"
	case strings.Contains(lower, "model.deployed"):
		return "model.deployed"
	case strings.Contains(lower, "model.undeployed"):
		return "model.undeployed"
	case strings.Contains(lower, "training.started"):
		return "training.started"
	case strings.Contains(lower, "training.completed"):
		return "training.completed"
	case strings.Contains(lower, "dataset.linked"):
		return "dataset.linked"
	case strings.Contains(lower, "inference.logged"):
		return "inference.logged"
	case strings.Contains(lower, "drift.detected"):
		return "drift.detected"
	default:
		return "external_event"
	}
}

func subjectName(subject string) string {
	if subject == "" {
		return ""
	}
	trimmed := strings.Trim(subject, "/")
	if trimmed == "" {
		return ""
	}
	parts := strings.Split(trimmed, "/")
	return parts[len(parts)-1]
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
