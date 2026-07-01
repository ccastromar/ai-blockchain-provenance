package huggingface

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
	event := objectValue(payload, "event")
	repo := objectValue(payload, "repo")
	webhook := objectValue(payload, "webhook")

	action := stringValue(event, "action")
	scope := stringValue(event, "scope")
	repoType := stringValue(repo, "type")
	repoName := stringValue(repo, "name")
	headSha := stringValue(repo, "headSha")
	webhookID := stringValue(webhook, "id")

	modelID := repoName
	if modelID == "" {
		modelID = "huggingface-unknown"
	}

	eventType := mapEventType(repoType, scope, action)
	sourceEventID := buildSourceEventID(webhookID, repoName, scope, action, headSha, rawBody)

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     repoName,
		"sourceEventId": sourceEventID,
		"provider":      "huggingface",
		"repoType":      repoType,
		"repoName":      repoName,
		"repoHeadSha":   headSha,
		"gitCommit":     headSha,
		"metadata": map[string]any{
			"provider":        "huggingface",
			"hfEventAction":   action,
			"hfEventScope":    scope,
			"hfRepoType":      repoType,
			"hfRepoName":      repoName,
			"hfWebhookId":     webhookID,
			"hfRawEventHash":  sha256Hex(rawBody),
			"huggingFaceUrl":  nestedString(repo, "url", "web"),
			"huggingFaceApi":  nestedString(repo, "url", "api"),
			"updatedRefs":     payload["updatedRefs"],
			"updatedConfig":   payload["updatedConfig"],
			"discussion":      payload["discussion"],
			"comment":         payload["comment"],
			"originalPayload": payload,
		},
	}

	if headSha != "" {
		normalized["version"] = shortSHA(headSha)
	}

	return AdaptedEvent{
		Source:        "huggingface",
		EventType:     eventType,
		SourceEventID: sourceEventID,
		Payload:       normalized,
	}
}

func mapEventType(repoType string, scope string, action string) string {
	if repoType != "model" {
		if strings.HasPrefix(scope, "repo.content") {
			return "dataset.linked"
		}
		return "external_event"
	}

	switch {
	case scope == "repo" && action == "create":
		return "model.registered"
	case scope == "repo" && action == "delete":
		return "model.deprecated"
	case scope == "repo.content":
		return "model.version.created"
	case strings.HasPrefix(scope, "repo.config"):
		return "model.updated"
	case scope == "discussion" || scope == "discussion.comment":
		return "model.card.updated"
	default:
		return "model.updated"
	}
}

func buildSourceEventID(webhookID string, repoName string, scope string, action string, headSha string, rawBody []byte) string {
	parts := []string{"hf"}
	for _, value := range []string{webhookID, repoName, scope, action, headSha} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, strings.ReplaceAll(value, " ", "-"))
		}
	}
	if len(parts) == 1 {
		return "hf-" + sha256Hex(rawBody)
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

func nestedString(payload map[string]any, keys ...string) string {
	current := payload
	for i, key := range keys {
		if i == len(keys)-1 {
			return stringValue(current, key)
		}
		current = objectValue(current, key)
		if current == nil {
			return ""
		}
	}
	return ""
}

func shortSHA(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}

func sha256Hex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
