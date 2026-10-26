package kafkasource

import (
	"context"
	"testing"

	"event-ingestor/internal/events"
	"event-ingestor/internal/hashchain"

	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

type countingWriter struct{ appended int }

func (w *countingWriter) EnsureIndexes(context.Context) error { return nil }
func (w *countingWriter) AppendEvent(context.Context, events.CanonicalEvent) (hashchain.Block, error) {
	w.appended++
	return hashchain.Block{Index: -1}, nil
}
func (w *countingWriter) RecordFailure(context.Context, string, map[string]string, error) error {
	return nil
}
func (w *countingWriter) MarkDuplicate(context.Context, events.CanonicalEvent) error { return nil }

// Processing a poll is a new span linked to the contexts its records were produced in, never
// their child (Chestertown observability conventions, section 4).
func TestProcessingAPollLinksToTheProducersTraces(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	body := []byte(`{"source":"aos","eventType":"aos.audit.event.pipeline.started","sourceEventId":"t:1","metadata":{"correlationId":"t"}}`)
	records := []*kgo.Record{
		{Value: body, Headers: []kgo.RecordHeader{
			{Key: "source", Value: []byte("aos")},
			{Key: "traceparent", Value: []byte("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")},
		}},
		{Value: body, Headers: []kgo.RecordHeader{{Key: "traceparent", Value: []byte("not a traceparent")}}},
	}
	writer := &countingWriter{}
	if err := record(context.Background(), writer, records, UnverifiedStatus); err != nil {
		t.Fatal(err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "ernest.kafka.process" {
		t.Fatalf("spans = %v", spans)
	}
	span := spans[0]
	if span.Parent().IsValid() {
		t.Error("the processing span is a child of the producer's span")
	}
	links := span.Links()
	if len(links) != 1 || links[0].SpanContext.TraceID().String() != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("links = %+v", links)
	}
	if writer.appended != 2 {
		t.Errorf("appended = %d", writer.appended)
	}
}
