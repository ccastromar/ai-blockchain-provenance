package ingest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

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

func TestAttachVerificationMarksProviderHMAC(t *testing.T) {
	payload := map[string]any{"modelId": "model-1"}
	attachVerification(payload, "provider_hmac")

	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatal("expected metadata to be created")
	}
	if metadata["verificationStatus"] != "provider_hmac" {
		t.Fatalf("unexpected verification status: %v", metadata["verificationStatus"])
	}
	if metadata["verificationMethod"] != "X-Ernest-Provider-Signature" {
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

func TestValidProviderHMACAcceptsFreshSignedRequest(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := signedRequest(t, body, "secret", time.Now())

	if !handler.validProviderHMAC(req, body) {
		t.Fatal("expected a freshly signed request to be accepted")
	}
}

func TestValidProviderHMACRejectsWrongSecret(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := signedRequest(t, body, "wrong-secret", time.Now())

	if handler.validProviderHMAC(req, body) {
		t.Fatal("expected wrong secret to be rejected")
	}
}

func TestValidProviderHMACRejectsTamperedBody(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	req := signedRequest(t, []byte(`{"id":"evt-1"}`), "secret", time.Now())

	if handler.validProviderHMAC(req, []byte(`{"id":"evt-2"}`)) {
		t.Fatal("expected a body that doesn't match the signed body to be rejected")
	}
}

func TestValidProviderHMACRejectsMissingTimestamp(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := httptest.NewRequest("POST", "/events/vertexai", nil)
	// Signed the old way (over the body alone, no timestamp) -- must not validate,
	// otherwise a pre-timestamp-scheme signature would still work forever.
	req.Header.Set("X-Ernest-Provider-Signature", "sha256="+testHMACRaw(body, "secret"))

	if handler.validProviderHMAC(req, body) {
		t.Fatal("expected a request without X-Ernest-Provider-Timestamp to be rejected")
	}
}

func TestValidProviderHMACRejectsStaleTimestamp(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := signedRequest(t, body, "secret", time.Now().Add(-time.Hour))

	if handler.validProviderHMAC(req, body) {
		t.Fatal("expected a signature captured over an hour ago to be rejected as stale (replay protection)")
	}
}

func TestValidProviderHMACRejectsFutureTimestamp(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := signedRequest(t, body, "secret", time.Now().Add(time.Hour))

	if handler.validProviderHMAC(req, body) {
		t.Fatal("expected a timestamp far in the future to be rejected")
	}
}

func TestValidProviderHMACAcceptsTimestampWithinTolerance(t *testing.T) {
	handler := NewHandler(nil, config.Config{ProviderHMACSecret: "secret", ProviderHMACTolerance: 5 * time.Minute})
	body := []byte(`{"id":"evt-1"}`)
	req := signedRequest(t, body, "secret", time.Now().Add(-4*time.Minute))

	if !handler.validProviderHMAC(req, body) {
		t.Fatal("expected a timestamp within tolerance to be accepted")
	}
}

func signedRequest(t *testing.T, body []byte, secret string, at time.Time) *http.Request {
	t.Helper()
	timestamp := strconv.FormatInt(at.Unix(), 10)
	req := httptest.NewRequest("POST", "/events/vertexai", nil)
	req.Header.Set("X-Ernest-Provider-Timestamp", timestamp)
	req.Header.Set("X-Ernest-Provider-Signature", "sha256="+testHMACWithTimestamp(timestamp, body, secret))
	return req
}

func testHMACWithTimestamp(timestamp string, body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func testHMACRaw(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestRateLimitedBlocksAfterBurstExhausted(t *testing.T) {
	handler := NewHandler(nil, config.Config{RateLimitRPS: 1, RateLimitBurst: 2})
	wrapped := handler.rateLimited(okHandler())

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/events", nil)
		req.RemoteAddr = "203.0.113.5:12345"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200 within burst, got %d", i, rec.Code)
		}
	}

	req := httptest.NewRequest("POST", "/events", nil)
	req.RemoteAddr = "203.0.113.5:12345"
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 once burst exhausted, got %d", rec.Code)
	}
}

func TestRateLimitedTracksClientsBySourceIPIndependently(t *testing.T) {
	handler := NewHandler(nil, config.Config{RateLimitRPS: 1, RateLimitBurst: 1})
	wrapped := handler.rateLimited(okHandler())

	reqA := httptest.NewRequest("POST", "/events", nil)
	reqA.RemoteAddr = "203.0.113.10:1"
	recA := httptest.NewRecorder()
	wrapped.ServeHTTP(recA, reqA)
	if recA.Code != http.StatusOK {
		t.Fatalf("client A: expected first request to succeed, got %d", recA.Code)
	}

	reqB := httptest.NewRequest("POST", "/events", nil)
	reqB.RemoteAddr = "203.0.113.20:1"
	recB := httptest.NewRecorder()
	wrapped.ServeHTTP(recB, reqB)
	if recB.Code != http.StatusOK {
		t.Fatalf("client B: expected its own independent bucket to allow the request, got %d", recB.Code)
	}
}

func TestRateLimitedExemptsHealthEndpoint(t *testing.T) {
	handler := NewHandler(nil, config.Config{RateLimitRPS: 1, RateLimitBurst: 1})
	wrapped := handler.rateLimited(okHandler())

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/health", nil)
		req.RemoteAddr = "203.0.113.9:1"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("health check %d: expected 200 (exempt from rate limit), got %d", i, rec.Code)
		}
	}
}

func TestRateLimitedDisabledAllowsUnlimitedRequests(t *testing.T) {
	handler := NewHandler(nil, config.Config{}) // RateLimitRPS zero value: disabled
	wrapped := handler.rateLimited(okHandler())

	for i := 0; i < 10; i++ {
		req := httptest.NewRequest("POST", "/events", nil)
		req.RemoteAddr = "203.0.113.1:1"
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected disabled limiter (RPS=0) to allow, got %d", i, rec.Code)
		}
	}
}

func TestProviderFromPathIsBoundedAndDefaultsToUnknown(t *testing.T) {
	cases := map[string]string{
		"/events":                    "events",
		"/events/cloudevents":        "cloudevents",
		"/events/huggingface":        "huggingface",
		"/events/sagemaker":          "sagemaker",
		"/events/azureml":            "azureml",
		"/events/databricks":         "databricks",
		"/events/vertexai":           "vertexai",
		"/events/openlineage":        "openlineage",
		"/events/opentelemetry/logs": "opentelemetry",
		"/events/totally-made-up":    "unknown",
		"/whatever-a-caller-sends":   "unknown",
	}
	for path, want := range cases {
		if got := providerFromPath(path); got != want {
			t.Errorf("providerFromPath(%q) = %q, want %q", path, got, want)
		}
	}
}
