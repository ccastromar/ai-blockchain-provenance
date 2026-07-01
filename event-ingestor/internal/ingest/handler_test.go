package ingest

import (
	"net/http/httptest"
	"testing"

	"event-ingestor/internal/config"
)

func TestVerifyIngestAuthAllowsDevModeWithoutKey(t *testing.T) {
	handler := NewHandler(nil, config.Config{})
	status, ok := handler.verifyIngestAuth(httptest.NewRequest("POST", "/events", nil))

	if !ok {
		t.Fatal("expected dev mode auth to allow the request")
	}
	if status != "unverified" {
		t.Fatalf("expected unverified status, got %q", status)
	}
}

func TestVerifyIngestAuthRequiresConfiguredKey(t *testing.T) {
	handler := NewHandler(nil, config.Config{IngestorAPIKey: "secret"})

	if _, ok := handler.verifyIngestAuth(httptest.NewRequest("POST", "/events", nil)); ok {
		t.Fatal("expected request without key to be rejected")
	}

	req := httptest.NewRequest("POST", "/events", nil)
	req.Header.Set("X-Ernest-Ingest-Key", "secret")
	status, ok := handler.verifyIngestAuth(req)

	if !ok {
		t.Fatal("expected request with matching key to be allowed")
	}
	if status != "shared_secret" {
		t.Fatalf("expected shared_secret status, got %q", status)
	}
}

func TestAttachVerificationAddsMetadata(t *testing.T) {
	payload := map[string]any{"modelId": "model-1"}
	attachVerification(payload, "shared_secret")

	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatal("expected metadata to be created")
	}
	if metadata["verificationStatus"] != "shared_secret" {
		t.Fatalf("unexpected verification status: %v", metadata["verificationStatus"])
	}
	if metadata["verificationMethod"] != "X-Ernest-Ingest-Key" {
		t.Fatalf("unexpected verification method: %v", metadata["verificationMethod"])
	}
}

func TestAttachVerificationMarksProviderSecret(t *testing.T) {
	payload := map[string]any{"modelId": "model-1"}
	attachVerification(payload, "provider_secret")

	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatal("expected metadata to be created")
	}
	if metadata["verificationStatus"] != "provider_secret" {
		t.Fatalf("unexpected verification status: %v", metadata["verificationStatus"])
	}
	if metadata["verificationMethod"] != "X-Webhook-Secret" {
		t.Fatalf("unexpected verification method: %v", metadata["verificationMethod"])
	}
}

func TestAttachTransportAuthAddsSharedSecretMetadata(t *testing.T) {
	payload := map[string]any{"modelId": "model-1"}
	attachVerification(payload, "provider_secret")
	attachTransportAuth(payload, "shared_secret")

	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatal("expected metadata to be created")
	}
	if metadata["transportAuth"] != "X-Ernest-Ingest-Key" {
		t.Fatalf("unexpected transport auth: %v", metadata["transportAuth"])
	}
}
