package azureml

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
	data := objectValue(payload, "data")
	eventType := firstString(payload, "eventType", "type")
	id := stringValue(payload, "id")
	subject := stringValue(payload, "subject")
	topic := stringValue(payload, "topic")
	eventTime := firstString(payload, "eventTime", "time")

	modelID := firstNonEmpty(
		firstString(data, "modelName", "model_name", "modelId", "model_id", "jobName", "job_name", "endpointName", "endpoint_name", "name"),
		subjectName(subject),
		"azureml-unknown",
	)
	version := firstString(data, "modelVersion", "model_version", "version", "runId", "run_id", "jobName")
	artifactHash := firstString(data, "modelHash", "artifactHash", "artifact_hash", "assetHash")
	artifactURI := firstString(data, "modelUri", "model_uri", "assetUri", "asset_uri", "artifactUri", "artifact_uri")
	status := firstString(data, "status", "runStatus", "jobStatus", "provisioningState", "deploymentState")
	workspace := firstString(data, "workspaceName", "workspace_name", "workspace")
	resourceID := firstString(data, "resourceId", "resource_id")

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     firstNonEmpty(firstString(data, "modelDisplayName", "displayName"), modelID),
		"sourceEventId": buildSourceEventID(id, eventType, subject, modelID, version, rawBody),
		"provider":      "azureml",
		"occurredAt":    eventTime,
		"metadata": map[string]any{
			"provider":            "azureml",
			"azureEventId":        id,
			"azureEventType":      eventType,
			"azureSubject":        subject,
			"azureTopic":          topic,
			"azureWorkspace":      workspace,
			"azureResourceId":     resourceID,
			"azureStatus":         status,
			"azureRunId":          firstString(data, "runId", "run_id"),
			"azureJobName":        firstString(data, "jobName", "job_name"),
			"azureEndpointName":   firstString(data, "endpointName", "endpoint_name"),
			"azureDeploymentName": firstString(data, "deploymentName", "deployment_name"),
			"azureMetricName":     firstString(data, "metricName", "metric_name"),
			"azureRawEventHash":   sha256Hex(rawBody),
			"artifactUri":         artifactURI,
		},
	}

	if version != "" {
		normalized["version"] = version
	}
	if artifactHash != "" {
		normalized["artifactHash"] = artifactHash
	}
	if artifactURI != "" {
		normalized["artifactUri"] = artifactURI
	}
	if metrics := objectValue(data, "metrics"); len(metrics) > 0 {
		normalized["metrics"] = metrics
	}
	if gitCommit := firstString(data, "gitCommit", "git_commit", "codeCommit"); gitCommit != "" {
		normalized["gitCommit"] = gitCommit
	}

	return AdaptedEvent{
		Source:        "azureml",
		EventType:     mapEventType(eventType, status, subject),
		SourceEventID: normalized["sourceEventId"].(string),
		Payload:       normalized,
	}
}

func mapEventType(eventType string, status string, subject string) string {
	lower := strings.ToLower(eventType + " " + subject)
	lowerStatus := strings.ToLower(status)

	switch {
	case strings.Contains(lower, "drift") || strings.Contains(lower, "monitor"):
		return "drift.detected"
	case strings.Contains(lower, "deploy") || strings.Contains(lower, "endpoint"):
		if strings.Contains(lowerStatus, "delete") || strings.Contains(lowerStatus, "failed") || strings.Contains(lowerStatus, "inactive") {
			return "model.undeployed"
		}
		return "model.deployed"
	case strings.Contains(lower, "run") || strings.Contains(lower, "job") || strings.Contains(lower, "pipeline"):
		if lowerStatus == "completed" || lowerStatus == "succeeded" || lowerStatus == "finished" || lowerStatus == "failed" || lowerStatus == "canceled" {
			return "training.completed"
		}
		return "training.started"
	case strings.Contains(lower, "model") && (strings.Contains(lower, "register") || strings.Contains(lower, "create")):
		return "model.registered"
	case strings.Contains(lower, "model"):
		return "model.updated"
	default:
		return "external_event"
	}
}

func buildSourceEventID(id string, eventType string, subject string, modelID string, version string, rawBody []byte) string {
	parts := []string{"azml"}
	for _, value := range []string{id, eventType, subject, modelID, version} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, sanitize(value))
		}
	}
	if len(parts) == 1 {
		return "azml-" + sha256Hex(rawBody)
	}
	return strings.Join(parts, ":")
}

func sanitize(value string) string {
	value = strings.ReplaceAll(value, " ", "-")
	value = strings.ReplaceAll(value, "/", "-")
	return value
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
