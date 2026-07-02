package vertexai

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
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
	logEntry := unwrapPubSubLogEntry(payload)
	protoPayload := objectValue(logEntry, "protoPayload")
	resource := objectValue(logEntry, "resource")
	labels := objectValue(resource, "labels")
	request := objectValue(protoPayload, "request")
	response := objectValue(protoPayload, "response")
	metadata := objectValue(protoPayload, "metadata")
	requestDeployedModel := objectValue(request, "deployedModel")
	responseDeployedModel := objectValue(response, "deployedModel")

	insertID := firstString(logEntry, "insertId", "id")
	methodName := firstString(protoPayload, "methodName")
	serviceName := firstString(protoPayload, "serviceName")
	resourceName := firstString(protoPayload, "resourceName")
	timestamp := firstString(logEntry, "timestamp", "receiveTimestamp")
	projectID := firstNonEmpty(firstString(labels, "project_id"), projectFromResourceName(resourceName))
	location := firstNonEmpty(firstString(labels, "location"), locationFromResourceName(resourceName))

	modelID := firstNonEmpty(
		modelFromResourceName(resourceName),
		modelFromResourceName(firstString(request, "name", "model", "parent")),
		modelFromResourceName(firstString(response, "name", "model")),
		modelFromResourceName(firstString(requestDeployedModel, "model")),
		modelFromResourceName(firstString(responseDeployedModel, "model")),
		firstString(request, "displayName", "display_name", "modelDisplayName"),
		firstString(response, "displayName", "display_name", "modelDisplayName"),
		firstString(metadata, "modelName", "model_name"),
		"vertexai-unknown",
	)
	version := firstNonEmpty(
		firstString(request, "versionId", "version_id", "modelVersionId", "model_version_id"),
		firstString(response, "versionId", "version_id", "modelVersionId", "model_version_id"),
		versionFromResourceName(resourceName),
	)
	artifactURI := firstNonEmpty(
		firstString(request, "artifactUri", "artifact_uri", "uri"),
		firstString(response, "artifactUri", "artifact_uri", "uri"),
	)
	eventID := buildSourceEventID(insertID, methodName, resourceName, modelID, version, rawBody)

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     firstNonEmpty(firstString(request, "displayName", "display_name"), firstString(response, "displayName", "display_name"), modelID),
		"sourceEventId": eventID,
		"provider":      "vertexai",
		"occurredAt":    timestamp,
		"metadata": map[string]any{
			"provider":                 "vertexai",
			"vertexAuditInsertId":      insertID,
			"vertexServiceName":        serviceName,
			"vertexMethodName":         methodName,
			"vertexResourceName":       resourceName,
			"vertexProjectId":          projectID,
			"vertexLocation":           location,
			"vertexEndpoint":           endpointFromResourceName(resourceName),
			"vertexDeployedModelId":    deployedModelID(request, response),
			"vertexPrincipalEmail":     principalEmail(protoPayload),
			"vertexPubSubMessageId":    pubSubMessageID(payload),
			"vertexLogName":            firstString(logEntry, "logName"),
			"vertexRawAuditLogHash":    sha256Hex(rawBody),
			"artifactUri":              artifactURI,
			"auditLogAuthentication":   objectValue(protoPayload, "authenticationInfo"),
			"auditLogAuthorization":    objectValue(protoPayload, "authorizationInfo"),
			"auditLogRequestMetadata":  objectValue(protoPayload, "requestMetadata"),
			"auditLogStatus":           objectValue(protoPayload, "status"),
			"auditLogResourceLocation": objectValue(protoPayload, "resourceLocation"),
		},
	}

	if version != "" {
		normalized["version"] = version
	}
	if artifactHash := firstNonEmpty(firstString(request, "artifactHash", "artifact_hash", "modelHash"), firstString(response, "artifactHash", "artifact_hash", "modelHash")); artifactHash != "" {
		normalized["artifactHash"] = artifactHash
	}
	if artifactURI != "" {
		normalized["artifactUri"] = artifactURI
	}
	if gitCommit := firstString(request, "gitCommit", "git_commit", "sourceCommit"); gitCommit != "" {
		normalized["gitCommit"] = gitCommit
	}
	if metrics := objectValue(response, "metrics"); len(metrics) > 0 {
		normalized["metrics"] = metrics
	}

	return AdaptedEvent{
		Source:        "vertexai",
		EventType:     mapEventType(methodName, resourceName),
		SourceEventID: eventID,
		Payload:       normalized,
	}
}

func unwrapPubSubLogEntry(payload map[string]any) map[string]any {
	message := objectValue(payload, "message")
	if len(message) == 0 {
		return payload
	}
	data := firstString(message, "data")
	if data == "" {
		return payload
	}
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return payload
	}
	var logEntry map[string]any
	if err := json.Unmarshal(decoded, &logEntry); err != nil {
		return payload
	}
	return logEntry
}

func mapEventType(methodName string, resourceName string) string {
	lower := strings.ToLower(methodName + " " + resourceName)
	switch {
	case strings.Contains(lower, "deploymodel") || strings.Contains(lower, "endpoint") && strings.Contains(lower, "deploy"):
		return "model.deployed"
	case strings.Contains(lower, "undeploymodel") || strings.Contains(lower, "deleteendpoint"):
		return "model.undeployed"
	case strings.Contains(lower, "uploadmodel") || strings.Contains(lower, "importmodel") || strings.Contains(lower, "createmodel"):
		return "model.registered"
	case strings.Contains(lower, "modelversion") || strings.Contains(lower, "version"):
		return "model.version.created"
	case strings.Contains(lower, "delete") || strings.Contains(lower, "archive"):
		return "model.deprecated"
	case strings.Contains(lower, "pipeline") || strings.Contains(lower, "customjob") || strings.Contains(lower, "training"):
		if strings.Contains(lower, "create") || strings.Contains(lower, "start") {
			return "training.started"
		}
		return "training.completed"
	case strings.Contains(lower, "batchprediction") || strings.Contains(lower, "predict"):
		return "inference.logged"
	default:
		return "model.updated"
	}
}

func buildSourceEventID(insertID string, methodName string, resourceName string, modelID string, version string, rawBody []byte) string {
	// insertID alone should already make this unique for real GCP audit logs, but nothing
	// enforces that it's present. modelID always falls back to a non-empty placeholder, so
	// without a hash fallback here, two distinct payloads missing insertId/methodName/
	// resourceName/version would collide on the same sourceEventId and the second would be
	// silently dropped as a duplicate instead of recorded.
	if strings.TrimSpace(insertID) == "" && strings.TrimSpace(methodName) == "" && strings.TrimSpace(resourceName) == "" {
		return "vertex-" + sha256Hex(rawBody)
	}

	parts := []string{"vertex"}
	for _, value := range []string{insertID, methodName, resourceName, modelID, version} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, sanitize(value))
		}
	}
	return strings.Join(parts, ":")
}

func modelFromResourceName(value string) string {
	return resourceSegment(value, "models")
}

func versionFromResourceName(value string) string {
	return resourceSegment(value, "versions")
}

func endpointFromResourceName(value string) string {
	return resourceSegment(value, "endpoints")
}

func projectFromResourceName(value string) string {
	return resourceSegment(value, "projects")
}

func locationFromResourceName(value string) string {
	return resourceSegment(value, "locations")
}

func resourceSegment(value string, key string) string {
	parts := strings.Split(value, "/")
	for i := 0; i < len(parts)-1; i++ {
		if parts[i] == key {
			return parts[i+1]
		}
	}
	return ""
}

func deployedModelID(request map[string]any, response map[string]any) string {
	if deployedModel := objectValue(request, "deployedModel"); len(deployedModel) > 0 {
		return firstString(deployedModel, "id", "deployedModelId", "model")
	}
	if deployedModel := objectValue(response, "deployedModel"); len(deployedModel) > 0 {
		return firstString(deployedModel, "id", "deployedModelId", "model")
	}
	return firstNonEmpty(firstString(request, "deployedModelId", "deployed_model_id"), firstString(response, "deployedModelId", "deployed_model_id"))
}

func principalEmail(protoPayload map[string]any) string {
	auth := objectValue(protoPayload, "authenticationInfo")
	return firstString(auth, "principalEmail")
}

func pubSubMessageID(payload map[string]any) string {
	message := objectValue(payload, "message")
	return firstString(message, "messageId", "message_id")
}

func sanitize(value string) string {
	value = strings.ReplaceAll(value, " ", "-")
	value = strings.ReplaceAll(value, "/", "-")
	return value
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
