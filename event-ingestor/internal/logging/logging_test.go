package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

func TestLinesCarryTheSuitesFields(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, "", "0.3.0", "staging")
	logger.Warn("kafka fetch prudence.decisions[0] failed", "error.type", "*net.OpError")

	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
		t.Fatalf("not JSON: %q", buf.String())
	}
	if !regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`).MatchString(line["timestamp"].(string)) {
		t.Errorf("timestamp = %v", line["timestamp"])
	}
	for k, v := range map[string]any{
		"severity": "WARN", "message": "kafka fetch prudence.decisions[0] failed",
		"service.name": "ernest-ingestor", "service.version": "0.3.0",
		"deployment.environment.name": "staging", "error.type": "*net.OpError",
	} {
		if line[k] != v {
			t.Errorf("%s = %v, want %v", k, line[k], v)
		}
	}
	for _, old := range []string{"time", "level", "msg"} {
		if _, ok := line[old]; ok {
			t.Errorf("field %q should be renamed", old)
		}
	}
}

func TestFailuresGetTheirSeverityAndErrorType(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(New(&buf, "", "", "test"))
	t.Cleanup(func() { slog.SetDefault(previous) })

	Warnf("ack %s failed: %v", "1-0", &os.PathError{Op: "write", Path: "x", Err: errors.New("disk")})
	Errorf("worker failed: %v", errors.New("boom"))

	got := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(got) != 2 {
		t.Fatalf("lines = %q", got)
	}
	var warn, failure map[string]any
	_ = json.Unmarshal([]byte(got[0]), &warn)
	_ = json.Unmarshal([]byte(got[1]), &failure)
	if warn["severity"] != "WARN" || warn["error.type"] != "*fs.PathError" {
		t.Errorf("warn = %v", warn)
	}
	if failure["severity"] != "ERROR" || failure["error.type"] != "*errors.errorString" {
		t.Errorf("error = %v", failure)
	}
}

// A line logged inside an event's processing span names its trace; one without a context does not.
func TestLinesInsideASpanCarryItsTrace(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(New(&buf, "", "", "test"))
	t.Cleanup(func() { slog.SetDefault(previous) })

	traceID, _ := trace.TraceIDFromHex("0af7651916cd43dd8448eb211c80319c")
	spanID, _ := trace.SpanIDFromHex("b7ad6b7169203331")
	ctx := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled,
	}))
	InfoCtx(ctx, "kafka source: recorded %d events", 3)
	Warnf("redis read failed: %v", errors.New("refused"))

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	var inside, outside map[string]any
	_ = json.Unmarshal([]byte(lines[0]), &inside)
	_ = json.Unmarshal([]byte(lines[1]), &outside)
	if inside["trace_id"] != "0af7651916cd43dd8448eb211c80319c" || inside["span_id"] != "b7ad6b7169203331" || inside["message"] != "kafka source: recorded 3 events" {
		t.Errorf("inside = %v", inside)
	}
	if _, ok := outside["trace_id"]; ok {
		t.Errorf("outside = %v", outside)
	}
}
