package sagemaker

import (
	"encoding/json"
	"testing"
)

func TestAdaptApprovedModelPackage(t *testing.T) {
	raw := []byte(`{
		"id": "evt-1",
		"source": "aws.sagemaker",
		"detail-type": "SageMaker Model Package State Change",
		"account": "123456789012",
		"region": "eu-west-1",
		"time": "2026-06-30T09:00:00Z",
		"detail": {
			"ModelPackageGroupName": "credit-risk-xgb",
			"ModelPackageVersion": "7",
			"ModelApprovalStatus": "Approved",
			"ModelPackageArn": "arn:aws:sagemaker:eu-west-1:123456789012:model-package/credit-risk-xgb/7",
			"ModelDataUrl": "s3://ernest-models/credit-risk-xgb/7/model.tar.gz",
			"ModelArtifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.Source != "sagemaker" {
		t.Fatalf("source mismatch: %s", got.Source)
	}
	if got.EventType != "model.approved" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-xgb" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
	if got.Payload["version"] != "7" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
	if got.Payload["artifactHash"] != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("artifactHash mismatch: %#v", got.Payload["artifactHash"])
	}
}

func TestAdaptCompletedTrainingJob(t *testing.T) {
	raw := []byte(`{
		"id": "evt-2",
		"detail-type": "SageMaker Training Job State Change",
		"detail": {
			"TrainingJobName": "credit-risk-xgb-training-20260630",
			"TrainingJobStatus": "Completed",
			"ModelArtifactsS3Uri": "s3://ernest-models/credit-risk-xgb/training/model.tar.gz"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "training.completed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["modelId"] != "credit-risk-xgb-training-20260630" {
		t.Fatalf("modelId mismatch: %#v", got.Payload["modelId"])
	}
}

func TestAdaptEndpointDeployment(t *testing.T) {
	raw := []byte(`{
		"id": "evt-3",
		"detail-type": "SageMaker Endpoint State Change",
		"detail": {
			"EndpointName": "credit-risk-prod",
			"EndpointStatus": "InService",
			"EndpointConfigName": "credit-risk-prod-7"
		}
	}`)
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	got := Adapt(payload, raw)
	if got.EventType != "model.deployed" {
		t.Fatalf("event type mismatch: %s", got.EventType)
	}
	if got.Payload["version"] != "credit-risk-prod-7" {
		t.Fatalf("version mismatch: %#v", got.Payload["version"])
	}
}
