package databricks

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
	requestParams := objectValue(payload, "requestParams")
	response := objectValue(payload, "response")
	eventType := firstString(payload, "eventType", "actionName", "action", "type")
	id := firstString(payload, "id", "eventId", "requestId")
	occurredAt := firstString(payload, "time", "timestamp", "eventTime")

	modelFullName := firstNonEmpty(
		firstString(data, "fullName", "full_name", "registeredModelName", "registered_model_name", "modelName", "model_name", "name"),
		firstString(requestParams, "full_name", "registered_model_name", "name"),
		firstString(response, "full_name", "registered_model_name", "name"),
		"databricks-unknown",
	)
	version := firstNonEmpty(
		firstString(data, "version", "modelVersion", "model_version", "versionNumber", "version_number"),
		firstString(requestParams, "version", "model_version", "version_number"),
		firstString(response, "version", "model_version", "version_number"),
	)
	alias := firstNonEmpty(firstString(data, "alias"), firstString(requestParams, "alias"), firstString(response, "alias"))
	artifactURI := firstNonEmpty(firstString(data, "source", "artifactUri", "artifact_uri", "modelUri", "model_uri"), firstString(response, "source"))
	runID := firstNonEmpty(firstString(data, "runId", "run_id"), firstString(requestParams, "run_id"), firstString(response, "run_id"))
	eventID := buildSourceEventID(id, eventType, modelFullName, version, alias, rawBody)
	catalog, schema, modelName := modelNameParts(modelFullName)

	normalized := map[string]any{
		"modelId":       modelFullName,
		"modelName":     firstNonEmpty(modelName, modelFullName),
		"sourceEventId": eventID,
		"provider":      "databricks",
		"occurredAt":    occurredAt,
		"metadata": map[string]any{
			"provider":               "databricks",
			"databricksEventType":    eventType,
			"databricksEventId":      id,
			"databricksWorkspaceId":  firstString(payload, "workspaceId", "workspace_id"),
			"databricksWorkspaceUrl": firstString(payload, "workspaceUrl", "workspace_url"),
			"unityCatalogFullName":   modelFullName,
			"unityCatalogCatalog":    catalog,
			"unityCatalogSchema":     schema,
			"unityCatalogModelName":  modelName,
			"modelAlias":             alias,
			"runId":                  runID,
			"artifactUri":            artifactURI,
			"lineage":                lineageSummary(data),
			"databricksRawEventHash": sha256Hex(rawBody),
		},
	}

	if version != "" {
		normalized["version"] = version
	}
	if artifactHash := firstNonEmpty(firstString(data, "artifactHash", "artifact_hash", "modelHash"), firstString(response, "artifact_hash")); artifactHash != "" {
		normalized["artifactHash"] = artifactHash
	}
	if artifactURI != "" {
		normalized["artifactUri"] = artifactURI
	}
	if gitCommit := firstString(data, "gitCommit", "git_commit", "sourceCommit"); gitCommit != "" {
		normalized["gitCommit"] = gitCommit
	}
	if metrics := objectValue(data, "metrics"); len(metrics) > 0 {
		normalized["metrics"] = metrics
	}

	return AdaptedEvent{
		Source:        "databricks",
		EventType:     mapEventType(eventType, alias),
		SourceEventID: eventID,
		Payload:       normalized,
	}
}

func mapEventType(eventType string, alias string) string {
	lower := strings.ToLower(eventType)
	lowerAlias := strings.ToLower(alias)
	switch {
	case strings.Contains(lower, "lineage") || strings.Contains(lower, "input"):
		return "dataset.linked"
	case strings.Contains(lower, "serving") || strings.Contains(lower, "endpoint"):
		if strings.Contains(lower, "delete") || strings.Contains(lower, "remove") {
			return "model.undeployed"
		}
		return "model.deployed"
	case strings.Contains(lower, "alias"):
		if lowerAlias == "champion" || lowerAlias == "production" || lowerAlias == "prod" {
			return "model.deployed"
		}
		return "model.updated"
	case strings.Contains(lower, "approve"):
		return "model.approved"
	case strings.Contains(lower, "reject"):
		return "model.rejected"
	case strings.Contains(lower, "delete") || strings.Contains(lower, "archive") || strings.Contains(lower, "deprecat"):
		return "model.deprecated"
	case strings.Contains(lower, "version") || strings.Contains(lower, "register"):
		return "model.version.created"
	default:
		return "model.updated"
	}
}

func lineageSummary(data map[string]any) map[string]any {
	inputs := arrayValue(data, "inputs")
	if len(inputs) == 0 {
		inputs = arrayValue(data, "inputTables")
	}
	outputs := arrayValue(data, "outputs")
	if len(outputs) == 0 {
		outputs = arrayValue(data, "outputTables")
	}
	return map[string]any{
		"inputCount":   len(inputs),
		"outputCount":  len(outputs),
		"inputHashes":  tableHashes(inputs),
		"outputHashes": tableHashes(outputs),
	}
}

func tableHashes(items []any) []string {
	hashes := []string{}
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			name := firstString(object, "fullName", "full_name", "name", "tableName")
			if name != "" {
				hashes = append(hashes, sha256Hex([]byte(name)))
			}
		}
	}
	return hashes
}

func buildSourceEventID(id string, eventType string, modelFullName string, version string, alias string, rawBody []byte) string {
	parts := []string{"dbx"}
	for _, value := range []string{id, eventType, modelFullName, version, alias} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, sanitize(value))
		}
	}
	if len(parts) == 1 {
		return "dbx-" + sha256Hex(rawBody)
	}
	return strings.Join(parts, ":")
}

func modelNameParts(fullName string) (string, string, string) {
	parts := strings.Split(fullName, ".")
	if len(parts) != 3 {
		return "", "", fullName
	}
	return parts[0], parts[1], parts[2]
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
