// Package telemetry is the ingestor's OpenTelemetry tracing (Chestertown observability
// conventions): a tracer provider exporting OTLP over HTTP when an endpoint is configured, W3C
// trace context, and links from the processing of an event to the context that sent it.
//
// Configured by the standard OTEL_* variables. Without OTEL_EXPORTER_OTLP_ENDPOINT (or
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) no span is recorded or exported.
package telemetry

import (
	"context"
	"net/http"
	"os"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const instrumentation = "event-ingestor"

// Only W3C trace context: the correlation id travels in the event itself (metadata.correlationId).
var propagator = propagation.TraceContext{}

func init() {
	otel.SetTextMapPropagator(propagator)
}

// Enabled says whether spans are exported: an OTLP endpoint is configured and the SDK is not
// disabled.
func Enabled() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OTEL_SDK_DISABLED")), "true") {
		return false
	}
	return strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")) != "" ||
		strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")) != ""
}

// Setup installs the tracer provider when Enabled and returns the function that flushes and
// stops it. service.name defaults to "ernest-ingestor" and service.namespace to "chestertown";
// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override them.
func Setup(ctx context.Context) (func(context.Context) error, error) {
	if !Enabled() {
		return func(context.Context) error { return nil }, nil
	}
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	defaults := resource.NewSchemaless(
		attribute.String("service.name", "ernest-ingestor"),
		attribute.String("service.namespace", "chestertown"),
	)
	// Merged after the defaults, so the environment wins.
	detected, err := resource.New(ctx, resource.WithFromEnv(), resource.WithTelemetrySDK())
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(defaults, detected)
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}

// Tracer is the ingestor's tracer (a no-op until Setup installs a provider).
func Tracer() trace.Tracer {
	return otel.Tracer(instrumentation)
}

// Handler makes each request a server span named by its route, continuing the caller's trace.
func Handler(next http.Handler) http.Handler {
	return otelhttp.NewHandler(next, "ingest",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
		otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/health" }),
	)
}

// Detach is a context that carries ctx's span context but none of its deadline or
// cancellation.
func Detach(ctx context.Context) context.Context {
	return trace.ContextWithSpanContext(context.Background(), trace.SpanContextFromContext(ctx))
}

// Traceparent is the W3C traceparent of ctx's span, or "": stored with an event that is
// processed later.
func Traceparent(ctx context.Context) string {
	carrier := propagation.MapCarrier{}
	propagator.Inject(ctx, carrier)
	return carrier.Get("traceparent")
}

// Links are the links from the processing of a batch to the contexts its events were sent
// in: processing is a new span, never a child of a span that ended when the event was sent.
// Invalid or missing traceparents are skipped.
func Links(traceparents ...string) []trace.Link {
	var links []trace.Link
	for _, tp := range traceparents {
		if tp == "" {
			continue
		}
		sc := trace.SpanContextFromContext(propagator.Extract(context.Background(), propagation.MapCarrier{"traceparent": tp}))
		if sc.IsValid() {
			links = append(links, trace.Link{SpanContext: sc})
		}
	}
	return links
}
