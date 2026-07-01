package ingest

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"event-ingestor/internal/adapters/huggingface"
	"event-ingestor/internal/adapters/sagemaker"
	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/redisstream"
)

type Handler struct {
	stream *redisstream.Client
	cfg    config.Config
}

func NewHandler(stream *redisstream.Client, cfg config.Config) Handler {
	return Handler{stream: stream, cfg: cfg}
}

func (h Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", h.health)
	mux.HandleFunc("/events", h.events)
	mux.HandleFunc("/events/cloudevents", h.events)
	mux.HandleFunc("/events/huggingface", h.huggingFace)
	mux.HandleFunc("/events/sagemaker", h.sageMaker)
	return mux
}

func (h Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h Handler) events(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	transportStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, "unknown", "unknown", "invalid ingestor API key", "ingestor_api_key")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid ingestor API key"})
		return
	}
	verificationStatus := transportStatus

	body, err := io.ReadAll(io.LimitReader(r.Body, h.cfg.MaxPayloadBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read request body"})
		return
	}
	if int64(len(body)) > h.cfg.MaxPayloadBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "payload too large"})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	attachVerification(payload, verificationStatus)
	normalizedBody := []byte(mustJSON(payload))

	event := events.IngestedEvent{
		Source:        firstNonEmpty(r.Header.Get("X-Ernest-Event-Source"), stringFrom(payload, "source"), "unknown"),
		EventType:     firstNonEmpty(r.Header.Get("X-Ernest-Event-Type"), stringFrom(payload, "eventType"), stringFrom(payload, "type"), "unknown"),
		SourceEventID: firstNonEmpty(r.Header.Get("X-Ernest-Source-Event-Id"), stringFrom(payload, "sourceEventId"), stringFrom(payload, "id"), hash(body)),
		ReceivedAt:    time.Now().UTC(),
		RawEventHash:  hash(body),
		Payload:       payload,
		Headers:       selectedHeaders(r),
	}

	id, err := h.stream.XAdd(context.Background(), h.cfg.RedisStream, h.cfg.RedisMaxLen, map[string]string{
		"source":        event.Source,
		"eventType":     event.EventType,
		"sourceEventId": event.SourceEventID,
		"rawEventHash":  event.RawEventHash,
		"receivedAt":    event.ReceivedAt.Format(time.RFC3339Nano),
		"payload":       string(normalizedBody),
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not enqueue event"})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"redisStreamId":      id,
		"rawEventHash":       event.RawEventHash,
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) huggingFace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	transportStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, "huggingface", "unknown", "invalid ingestor API key", "ingestor_api_key")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid ingestor API key"})
		return
	}
	verificationStatus := transportStatus

	if h.cfg.HFWebhookSecret != "" {
		if !validHFSecret(r, h.cfg.HFWebhookSecret) {
			h.recordRejected(r, "huggingface", "unknown", "invalid Hugging Face webhook secret", "provider_secret")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid Hugging Face webhook secret"})
			return
		}
		verificationStatus = "provider_secret"
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, h.cfg.MaxPayloadBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read request body"})
		return
	}
	if int64(len(body)) > h.cfg.MaxPayloadBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "payload too large"})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := huggingface.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	if verificationStatus == "provider_secret" {
		attachTransportAuth(adapted.Payload, transportStatus)
	}
	id, err := h.stream.XAdd(context.Background(), h.cfg.RedisStream, h.cfg.RedisMaxLen, map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not enqueue Hugging Face event"})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           "huggingface",
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) sageMaker(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, "sagemaker", "unknown", "invalid ingestor API key", "ingestor_api_key")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid ingestor API key"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, h.cfg.MaxPayloadBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read request body"})
		return
	}
	if int64(len(body)) > h.cfg.MaxPayloadBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "payload too large"})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := sagemaker.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.stream.XAdd(context.Background(), h.cfg.RedisStream, h.cfg.RedisMaxLen, map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not enqueue SageMaker event"})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           "sagemaker",
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func hash(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func stringFrom(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func validHFSecret(r *http.Request, expected string) bool {
	provided := firstNonEmpty(r.Header.Get("X-Webhook-Secret"), r.URL.Query().Get("secret"))
	if provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func (h Handler) verifyIngestAuth(r *http.Request) (string, bool) {
	if h.cfg.IngestorAPIKey == "" {
		return "unverified", true
	}
	provided := r.Header.Get("X-Ernest-Ingest-Key")
	if provided == "" {
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(provided), []byte(h.cfg.IngestorAPIKey)) != 1 {
		return "", false
	}
	return "shared_secret", true
}

func attachVerification(payload map[string]any, status string) {
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		payload["metadata"] = metadata
	}
	metadata["verificationStatus"] = status
	switch status {
	case "provider_secret":
		metadata["verificationMethod"] = "X-Webhook-Secret"
	case "shared_secret":
		metadata["verificationMethod"] = "X-Ernest-Ingest-Key"
	default:
		metadata["verificationMethod"] = "none"
	}
}

func attachTransportAuth(payload map[string]any, transportStatus string) {
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		payload["metadata"] = metadata
	}
	if transportStatus == "shared_secret" {
		metadata["transportAuth"] = "X-Ernest-Ingest-Key"
		return
	}
	metadata["transportAuth"] = "none"
}

func (h Handler) recordRejected(r *http.Request, source string, eventType string, reason string, authFailureType string) {
	if h.cfg.RedisRejectedStream == "" || h.stream == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Second)
	defer cancel()
	_, _ = h.stream.XAdd(ctx, h.cfg.RedisRejectedStream, h.cfg.RedisMaxLen, map[string]string{
		"source":          source,
		"eventType":       eventType,
		"error":           reason,
		"failureKind":     "auth_rejected",
		"authFailureType": authFailureType,
		"receivedAt":      time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func mustJSON(value any) string {
	bytes, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(bytes)
}

func selectedHeaders(r *http.Request) map[string]string {
	headers := map[string]string{}
	for _, key := range []string{"Content-Type", "User-Agent", "X-Hub-Signature-256", "X-GitHub-Delivery"} {
		if value := r.Header.Get(key); value != "" {
			headers[key] = value
		}
	}
	return headers
}
