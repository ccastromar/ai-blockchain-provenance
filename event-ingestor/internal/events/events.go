package events

import "time"

type IngestedEvent struct {
	Source        string            `json:"source"`
	EventType     string            `json:"eventType"`
	SourceEventID string            `json:"sourceEventId"`
	ReceivedAt    time.Time         `json:"receivedAt"`
	RawEventHash  string            `json:"rawEventHash"`
	Payload       map[string]any    `json:"payload"`
	Headers       map[string]string `json:"headers,omitempty"`
}

type CanonicalEvent struct {
	Type          string         `json:"type"`
	ModelID       string         `json:"modelId"`
	ModelName     string         `json:"modelName,omitempty"`
	Version       string         `json:"version,omitempty"`
	ModelHash     string         `json:"modelHash,omitempty"`
	GitCommit     string         `json:"gitCommit,omitempty"`
	InferenceID   string         `json:"inferenceId,omitempty"`
	InputHash     string         `json:"inputHash,omitempty"`
	OutputHash    string         `json:"outputHash,omitempty"`
	Params        map[string]any `json:"params,omitempty"`
	Metrics       map[string]any `json:"metrics,omitempty"`
	Source        string         `json:"source"`
	SourceEventID string         `json:"sourceEventId"`
	RawEventHash  string         `json:"rawEventHash"`
	OccurredAt    string         `json:"occurredAt,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

func Normalize(event IngestedEvent) CanonicalEvent {
	modelID := stringValue(event.Payload, "modelId")
	if modelID == "" {
		modelID = stringValue(event.Payload, "model_id")
	}
	if modelID == "" {
		modelID = "external-" + event.Source
	}

	occurredAt := stringValue(event.Payload, "occurredAt")
	if occurredAt == "" {
		occurredAt = stringValue(event.Payload, "time")
	}

	eventType := normalizeEventType(event.EventType)
	payloadMetadata := objectValue(event.Payload, "metadata")
	metadata := map[string]any{
		"eventType":        event.EventType,
		"canonicalType":    eventType,
		"payload":          event.Payload,
		"source":           event.Source,
		"sourceEventId":    event.SourceEventID,
		"rawEventHash":     event.RawEventHash,
		"normalizer":       "event-ingestor",
		"normalizerSchema": "v1",
	}
	for key, value := range payloadMetadata {
		metadata[key] = value
	}

	modelHash := firstString(event.Payload, "modelHash", "artifactHash", "artifact_hash")
	inputHash := firstString(event.Payload, "inputHash", "input_hash")
	outputHash := firstString(event.Payload, "outputHash", "output_hash")
	inferenceID := firstString(event.Payload, "inferenceId", "inference_id")
	if inferenceID == "" && eventType == "inference" {
		inferenceID = event.SourceEventID
	}

	return CanonicalEvent{
		Type:          eventType,
		ModelID:       modelID,
		ModelName:     firstString(event.Payload, "modelName", "model_name", "name"),
		Version:       firstString(event.Payload, "version", "modelVersion", "model_version"),
		ModelHash:     modelHash,
		GitCommit:     firstString(event.Payload, "gitCommit", "git_commit", "commit", "sha"),
		InferenceID:   inferenceID,
		InputHash:     inputHash,
		OutputHash:    outputHash,
		Params:        objectValue(event.Payload, "params"),
		Metrics:       objectValue(event.Payload, "metrics"),
		Source:        event.Source,
		SourceEventID: event.SourceEventID,
		RawEventHash:  event.RawEventHash,
		OccurredAt:    occurredAt,
		Metadata:      metadata,
	}
}

func normalizeEventType(eventType string) string {
	switch eventType {
	case "model.registered", "model.version.created", "model.created":
		return "model_registration"
	case "model.updated", "model.version.updated", "model.approved", "model.rejected", "model.deprecated", "model.card.updated":
		return "model_update"
	case "model.deployed":
		return "model_deployment"
	case "model.undeployed":
		return "model_undeployment"
	case "evaluation.logged":
		return "model_evaluation"
	case "drift.detected":
		return "model_monitoring"
	case "training.started":
		return "training_started"
	case "training.completed":
		return "training_completed"
	case "dataset.linked":
		return "dataset_linked"
	case "inference.logged":
		return "inference"
	default:
		return "external_event"
	}
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(payload, key); value != "" {
			return value
		}
	}
	return ""
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
	return ""
}
