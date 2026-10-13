package ingest

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"event-ingestor/internal/adapters/azureml"
	"event-ingestor/internal/adapters/cloudevents"
	"event-ingestor/internal/adapters/databricks"
	"event-ingestor/internal/adapters/huggingface"
	"event-ingestor/internal/adapters/openlineage"
	"event-ingestor/internal/adapters/opentelemetry"
	"event-ingestor/internal/adapters/sagemaker"
	"event-ingestor/internal/adapters/vertexai"
	"event-ingestor/internal/config"
	"event-ingestor/internal/events"
	"event-ingestor/internal/metrics"
	"event-ingestor/internal/ratelimit"
	"event-ingestor/internal/redisstream"
)

type Handler struct {
	stream  *redisstream.Client
	cfg     config.Config
	limiter *ratelimit.Limiter
	// authLimiter applies to callers with a valid ingestor API key, counted per key.
	authLimiter *ratelimit.Limiter
}

func NewHandler(stream *redisstream.Client, cfg config.Config) Handler {
	return Handler{
		stream:      stream,
		cfg:         cfg,
		limiter:     ratelimit.New(cfg.RateLimitRPS, cfg.RateLimitBurst),
		authLimiter: ratelimit.New(cfg.RateLimitAuthenticatedRPS, cfg.RateLimitAuthenticatedBurst),
	}
}

// RunRateLimitCleanup periodically evicts idle per-IP rate-limit buckets. Call it in a
// goroutine alongside the server; it returns when ctx is canceled.
func (h Handler) RunRateLimitCleanup(ctx context.Context) {
	go h.authLimiter.Run(ctx, 5*time.Minute, 10*time.Minute)
	h.limiter.Run(ctx, 5*time.Minute, 10*time.Minute)
}

func (h Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", h.health)
	mux.HandleFunc("/events", h.events)
	mux.HandleFunc("/events/azureml", h.azureML)
	mux.HandleFunc("/events/cloudevents", h.cloudEvents)
	mux.HandleFunc("/events/databricks", h.databricks)
	mux.HandleFunc("/events/huggingface", h.huggingFace)
	mux.HandleFunc("/events/openlineage", h.openLineage)
	mux.HandleFunc("/events/opentelemetry/logs", h.openTelemetryLogs)
	mux.HandleFunc("/events/sagemaker", h.sageMaker)
	mux.HandleFunc("/events/vertexai", h.vertexAI)
	return h.rateLimited(mux)
}

// rateLimited enforces a request budget on every route. /health is exempt so
// container/orchestrator liveness probes are never throttled. Callers presenting the valid
// ingestor API key are counted against their own (larger) budget; everyone else — provider
// webhooks, anonymous or wrong-key callers — per client IP, as before.
func (h Handler) rateLimited(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		limiter, key := h.limiter, ratelimit.ClientKey(r)
		if h.hasValidIngestKey(r) {
			limiter, key = h.authLimiter, "ingest-key"
		}
		if limiter.Enabled() && !limiter.Allow(key) {
			metrics.EventsRejected.WithLabelValues(providerFromPath(r.URL.Path), "rate_limited").Inc()
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h Handler) hasValidIngestKey(r *http.Request) bool {
	if h.cfg.IngestorAPIKey == "" {
		return false
	}
	provided := r.Header.Get("X-Ernest-Ingest-Key")
	return provided != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(h.cfg.IngestorAPIKey)) == 1
}

// providerFromPath maps a route to a fixed, bounded provider label for metrics. It must
// not derive labels from request content, only from the route itself.
func providerFromPath(path string) string {
	switch path {
	case "/events":
		return "events"
	case "/events/cloudevents":
		return "cloudevents"
	case "/events/huggingface":
		return "huggingface"
	case "/events/sagemaker":
		return "sagemaker"
	case "/events/azureml":
		return "azureml"
	case "/events/databricks":
		return "databricks"
	case "/events/vertexai":
		return "vertexai"
	case "/events/openlineage":
		return "openlineage"
	case "/events/opentelemetry/logs":
		return "opentelemetry"
	default:
		return "unknown"
	}
}

var errBacklogFull = errors.New("event backlog full")

// enqueue adds an event to the incoming stream without trimming it: entries are only
// removed once the worker has processed them (see Worker.trimAcknowledged). When the
// backlog is already at RedisMaxBacklog the event is refused (503, Retry-After) rather than
// accepted and later dropped — a sender with a retrying outbox (Prudence) just tries again.
func (h Handler) enqueue(ctx context.Context, fields map[string]string) (string, error) {
	if h.cfg.RedisMaxBacklog > 0 {
		if n, err := h.stream.XLen(ctx, h.cfg.RedisStream); err == nil && n >= h.cfg.RedisMaxBacklog {
			return "", errBacklogFull
		}
	}
	return h.stream.XAdd(ctx, h.cfg.RedisStream, 0, fields)
}

func writeEnqueueError(w http.ResponseWriter, err error, message string) {
	if errors.Is(err, errBacklogFull) {
		metrics.EventsRejected.WithLabelValues("any", "backpressure").Inc()
		w.Header().Set("Retry-After", "1")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "event backlog full, retry later"})
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": message})
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, "unknown", "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
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

	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        event.Source,
		"eventType":     event.EventType,
		"sourceEventId": event.SourceEventID,
		"rawEventHash":  event.RawEventHash,
		"receivedAt":    event.ReceivedAt.Format(time.RFC3339Nano),
		"payload":       string(normalizedBody),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue event")
		return
	}

	metrics.EventsAccepted.WithLabelValues("events").Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"redisStreamId":      id,
		"rawEventHash":       event.RawEventHash,
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) cloudEvents(w http.ResponseWriter, r *http.Request) {
	const provider = "cloudevents"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		h.recordValidationRejected(r, provider, "unknown", "invalid json payload", body)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted, err := cloudevents.Adapt(payload, body)
	if err != nil {
		h.recordValidationRejected(r, provider, stringFrom(payload, "type"), err.Error(), body)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue CloudEvents event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) huggingFace(w http.ResponseWriter, r *http.Request) {
	const provider = "huggingface"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	transportStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid ingestor API key"})
		return
	}
	verificationStatus := transportStatus

	if h.cfg.HFWebhookSecret != "" {
		if !validHFSecret(r, h.cfg.HFWebhookSecret) {
			h.recordRejected(r, provider, "unknown", "invalid Hugging Face webhook secret", "provider_secret")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
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
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue Hugging Face event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) sageMaker(w http.ResponseWriter, r *http.Request) {
	const provider = "sagemaker"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := sagemaker.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue SageMaker event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) azureML(w http.ResponseWriter, r *http.Request) {
	const provider = "azureml"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := azureml.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue Azure ML event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) databricks(w http.ResponseWriter, r *http.Request) {
	const provider = "databricks"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := databricks.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue Databricks event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) vertexAI(w http.ResponseWriter, r *http.Request) {
	const provider = "vertexai"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := vertexai.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue Vertex AI event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) openLineage(w http.ResponseWriter, r *http.Request) {
	const provider = "openlineage"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adapted := openlineage.Adapt(payload, body)
	attachVerification(adapted.Payload, verificationStatus)
	id, err := h.enqueue(context.Background(), map[string]string{
		"source":        adapted.Source,
		"eventType":     adapted.EventType,
		"sourceEventId": adapted.SourceEventID,
		"rawEventHash":  hash(body),
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       mustJSON(adapted.Payload),
	})
	if err != nil {
		writeEnqueueError(w, err, "could not enqueue OpenLineage event")
		return
	}

	metrics.EventsAccepted.WithLabelValues(provider).Inc()
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          adapted.EventType,
		"sourceEventId":      adapted.SourceEventID,
		"redisStreamId":      id,
		"rawEventHash":       hash(body),
		"verificationStatus": verificationStatus,
	})
}

func (h Handler) openTelemetryLogs(w http.ResponseWriter, r *http.Request) {
	const provider = "opentelemetry"
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	verificationStatus, ok := h.verifyIngestAuth(r)
	if !ok {
		h.recordRejected(r, provider, "unknown", "invalid ingestor API key", "ingestor_api_key")
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
	if h.cfg.ProviderHMACSecret != "" {
		if !h.validProviderHMAC(r, body) {
			h.recordRejected(r, provider, "unknown", "invalid provider HMAC signature", "provider_hmac")
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid provider HMAC signature"})
			return
		}
		verificationStatus = "provider_hmac"
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	adaptedEvents := opentelemetry.AdaptAll(payload, body)
	if len(adaptedEvents) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no OpenTelemetry log records found"})
		return
	}

	streamIDs := make([]string, 0, len(adaptedEvents))
	for _, adapted := range adaptedEvents {
		attachVerification(adapted.Payload, verificationStatus)
		id, err := h.enqueue(context.Background(), map[string]string{
			"source":        adapted.Source,
			"eventType":     adapted.EventType,
			"sourceEventId": adapted.SourceEventID,
			"rawEventHash":  hash(body),
			"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
			"payload":       mustJSON(adapted.Payload),
		})
		if err != nil {
			writeEnqueueError(w, err, "could not enqueue OpenTelemetry log event")
			return
		}
		streamIDs = append(streamIDs, id)
		metrics.EventsAccepted.WithLabelValues(provider).Inc()
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":             "accepted",
		"provider":           provider,
		"eventType":          "inference.logged",
		"sourceEventId":      adaptedEvents[0].SourceEventID,
		"acceptedCount":      len(adaptedEvents),
		"redisStreamIds":     streamIDs,
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

// validProviderHMAC checks the provider signature and a bound timestamp. Signing over
// "<timestamp>.<body>" (rather than the body alone) means a captured (body, signature)
// pair can't be replayed indefinitely: once the timestamp falls outside
// cfg.ProviderHMACTolerance, the same signature is rejected even though the secret and
// the math haven't changed. The timestamp itself is untrusted input, so it must be part
// of the signed material — otherwise anyone could swap in a fresh timestamp on a
// captured request without knowing the secret.
func (h Handler) validProviderHMAC(r *http.Request, body []byte) bool {
	provided := strings.TrimSpace(r.Header.Get("X-Ernest-Provider-Signature"))
	if provided == "" {
		return false
	}
	provided = strings.TrimPrefix(provided, "sha256=")

	timestampHeader := strings.TrimSpace(r.Header.Get("X-Ernest-Provider-Timestamp"))
	if timestampHeader == "" {
		return false
	}
	timestampUnix, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil {
		return false
	}
	skew := time.Since(time.Unix(timestampUnix, 0))
	if skew < 0 {
		skew = -skew
	}
	if skew > h.cfg.ProviderHMACTolerance {
		return false
	}

	expectedMAC := hmac.New(sha256.New, []byte(h.cfg.ProviderHMACSecret))
	expectedMAC.Write([]byte(timestampHeader))
	expectedMAC.Write([]byte("."))
	expectedMAC.Write(body)
	expected := hex.EncodeToString(expectedMAC.Sum(nil))
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

// AttachVerification records how an event's origin was authenticated in its payload metadata
// (shared by the Kafka source, ADR-005).
func AttachVerification(payload map[string]any, status string) { attachVerification(payload, status) }

func attachVerification(payload map[string]any, status string) {
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		payload["metadata"] = metadata
	}
	metadata["verificationStatus"] = status
	switch status {
	case "provider_hmac":
		metadata["verificationMethod"] = "X-Ernest-Provider-Signature"
	case "provider_secret":
		metadata["verificationMethod"] = "X-Webhook-Secret"
	case "shared_secret":
		metadata["verificationMethod"] = "X-Ernest-Ingest-Key"
	case "kafka_acl":
		metadata["verificationMethod"] = "Kafka topic ACL"
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
	metrics.EventsRejected.WithLabelValues(source, authFailureType).Inc()
	if h.cfg.RedisRejectedStream == "" || h.stream == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Second)
	defer cancel()
	_, _ = h.stream.XAdd(ctx, h.cfg.RedisRejectedStream, 0, map[string]string{
		"source":          source,
		"eventType":       eventType,
		"error":           reason,
		"failureKind":     "auth_rejected",
		"authFailureType": authFailureType,
		"receivedAt":      time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (h Handler) recordValidationRejected(r *http.Request, source string, eventType string, reason string, body []byte) {
	// reason is a free-form error string (e.g. an adapter validation message), so it must
	// never be used as a metric label value directly — that would let arbitrary input
	// mint unbounded Prometheus time series. Use a fixed "validation" label instead.
	metrics.EventsRejected.WithLabelValues(source, "validation").Inc()
	if h.cfg.RedisRejectedStream == "" || h.stream == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Second)
	defer cancel()
	_, _ = h.stream.XAdd(ctx, h.cfg.RedisRejectedStream, 0, map[string]string{
		"source":        source,
		"eventType":     firstNonEmpty(eventType, "unknown"),
		"sourceEventId": hash(body),
		"rawEventHash":  hash(body),
		"error":         reason,
		"failureKind":   "validation_rejected",
		"receivedAt":    time.Now().UTC().Format(time.RFC3339Nano),
		"payload":       string(body),
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
