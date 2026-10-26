// Package logging is the ingestor's log output (Chestertown observability conventions, section
// 5): one JSON object per line on stdout with `timestamp`, `severity`, `service.name`,
// `service.version`, `deployment.environment.name` and `message`. JSON unless LOG_FORMAT=text.
// Everything logged through the standard log package goes through it, at INFO; failures use
// Warnf, Errorf and Fatalf for their severity and `error.type`.
package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"go.opentelemetry.io/otel/trace"
)

// Version is service.version: the release the binary was built from, set at build time
// (-ldflags "-X event-ingestor/internal/logging.Version=0.3.0"; the Dockerfile's VERSION).
var Version = "dev"

// Setup installs the JSON logger as the default, unless LOG_FORMAT=text.
func Setup() {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LOG_FORMAT")), "text") {
		return
	}
	slog.SetDefault(New(os.Stdout, os.Getenv("OTEL_SERVICE_NAME"), Version, environment()))
}

// traced adds the trace_id and span_id of the context's span to each line logged with a
// context (InfoCtx, WarnCtx): a log line about an event's processing leads to its trace.
type traced struct{ slog.Handler }

func (h traced) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(slog.String("trace_id", sc.TraceID().String()), slog.String("span_id", sc.SpanID().String()))
	}
	return h.Handler.Handle(ctx, r)
}

func (h traced) WithAttrs(attrs []slog.Attr) slog.Handler { return traced{h.Handler.WithAttrs(attrs)} }
func (h traced) WithGroup(name string) slog.Handler       { return traced{h.Handler.WithGroup(name)} }

// InfoCtx logs at INFO with ctx's trace.
func InfoCtx(ctx context.Context, format string, args ...any) {
	slog.InfoContext(ctx, fmt.Sprintf(format, args...))
}

// WarnCtx is Warnf with ctx's trace.
func WarnCtx(ctx context.Context, format string, args ...any) {
	slog.WarnContext(ctx, fmt.Sprintf(format, args...), errorType(args)...)
}

// New is a logger writing the suite's JSON lines to w.
func New(w io.Writer, service, version, env string) *slog.Logger {
	if service == "" {
		service = "ernest-ingestor"
	}
	if version == "" {
		version = "dev"
	}
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) > 0 {
				return a
			}
			switch a.Key {
			case slog.TimeKey:
				return slog.String("timestamp", a.Value.Time().UTC().Format("2006-01-02T15:04:05.000Z07:00"))
			case slog.LevelKey:
				return slog.String("severity", severity(a.Value.Any().(slog.Level)))
			case slog.MessageKey:
				return slog.String("message", a.Value.String())
			}
			return a
		},
	})
	return slog.New(traced{handler}).With(
		"service.name", service,
		"service.version", version,
		"deployment.environment.name", env,
	)
}

// environment is deployment.environment.name as OpenTelemetry is given it, so logs and traces
// agree.
func environment() string {
	for _, pair := range strings.Split(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"), ",") {
		if key, value, ok := strings.Cut(strings.TrimSpace(pair), "="); ok && key == "deployment.environment.name" {
			return value
		}
	}
	return "production"
}

func severity(level slog.Level) string {
	switch {
	case level >= slog.LevelError:
		return "ERROR"
	case level >= slog.LevelWarn:
		return "WARN"
	case level >= slog.LevelInfo:
		return "INFO"
	default:
		return "DEBUG"
	}
}

// Warnf logs a failure the ingestor recovers from (a retry, a skipped event).
func Warnf(format string, args ...any) {
	slog.Warn(fmt.Sprintf(format, args...), errorType(args)...)
}

// Errorf logs a failure that needs someone.
func Errorf(format string, args ...any) {
	slog.Error(fmt.Sprintf(format, args...), errorType(args)...)
}

// Fatalf logs an ERROR and exits, like log.Fatalf.
func Fatalf(format string, args ...any) {
	Errorf(format, args...)
	os.Exit(1)
}

// errorType is `error.type` for the last error among args: its Go type.
func errorType(args []any) []any {
	for i := len(args) - 1; i >= 0; i-- {
		if err, ok := args[i].(error); ok {
			return []any{"error.type", fmt.Sprintf("%T", err)}
		}
	}
	return nil
}
