package sagemaker

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
	detail := objectValue(payload, "detail")

	detailType := firstString(payload, "detail-type", "detailType")
	id := stringValue(payload, "id")
	account := stringValue(payload, "account")
	region := stringValue(payload, "region")
	time := stringValue(payload, "time")

	modelID := firstString(detail,
		"ModelPackageGroupName",
		"ModelPackageName",
		"ModelName",
		"EndpointName",
		"TrainingJobName",
		"ModelCardName",
	)
	if modelID == "" {
		modelID = arnName(firstString(detail,
			"ModelPackageArn",
			"ModelArn",
			"EndpointArn",
			"TrainingJobArn",
			"ModelCardArn",
		))
	}
	if modelID == "" {
		modelID = "sagemaker-unknown"
	}

	version := firstString(detail, "ModelPackageVersion", "ModelVersion", "EndpointConfigName", "TrainingJobName")
	modelHash := firstString(detail, "ModelDataUrlHash", "ModelArtifactHash", "ImageDigest")
	artifactURI := firstString(detail, "ModelDataUrl", "ModelArtifactsS3Uri", "S3ModelArtifacts")

	eventType := mapEventType(detailType, detail)
	sourceEventID := buildSourceEventID(id, detailType, modelID, version, rawBody)

	normalized := map[string]any{
		"modelId":       modelID,
		"modelName":     modelID,
		"sourceEventId": sourceEventID,
		"provider":      "sagemaker",
		"occurredAt":    time,
		"region":        region,
		"account":       account,
		"metadata": map[string]any{
			"provider":              "sagemaker",
			"awsEventId":            id,
			"awsAccount":            account,
			"awsRegion":             region,
			"awsDetailType":         detailType,
			"sageMakerRawEventHash": sha256Hex(rawBody),
			"sageMakerStatus":       firstString(detail, "ModelApprovalStatus", "TrainingJobStatus", "EndpointStatus", "ModelCardStatus"),
			"sageMakerArn":          firstString(detail, "ModelPackageArn", "ModelArn", "EndpointArn", "TrainingJobArn", "ModelCardArn"),
			"artifactUri":           artifactURI,
			"originalPayload":       payload,
		},
	}

	if version != "" {
		normalized["version"] = version
	}
	if modelHash != "" {
		normalized["artifactHash"] = modelHash
	}
	if artifactURI != "" {
		normalized["artifactUri"] = artifactURI
	}

	return AdaptedEvent{
		Source:        "sagemaker",
		EventType:     eventType,
		SourceEventID: sourceEventID,
		Payload:       normalized,
	}
}

func mapEventType(detailType string, detail map[string]any) string {
	status := strings.ToLower(firstString(detail, "ModelApprovalStatus", "TrainingJobStatus", "EndpointStatus", "ModelCardStatus"))
	lowerDetailType := strings.ToLower(detailType)

	switch {
	case strings.Contains(lowerDetailType, "training job"):
		if status == "completed" {
			return "training.completed"
		}
		return "training.started"
	case strings.Contains(lowerDetailType, "model package"):
		if status == "approved" {
			return "model.approved"
		}
		if status == "rejected" {
			return "model.rejected"
		}
		return "model.version.created"
	case strings.Contains(lowerDetailType, "endpoint"):
		if status == "outofservice" || status == "deleting" || status == "deleted" {
			return "model.undeployed"
		}
		return "model.deployed"
	case strings.Contains(lowerDetailType, "model card"):
		return "model.card.updated"
	default:
		return "model.updated"
	}
}

func buildSourceEventID(id string, detailType string, modelID string, version string, rawBody []byte) string {
	parts := []string{"aws-sm"}
	for _, value := range []string{id, detailType, modelID, version} {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, strings.ReplaceAll(value, " ", "-"))
		}
	}
	if len(parts) == 1 {
		return "aws-sm-" + sha256Hex(rawBody)
	}
	return strings.Join(parts, ":")
}

func arnName(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, "/")
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

func sha256Hex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
