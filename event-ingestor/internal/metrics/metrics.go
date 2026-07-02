package metrics

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	EventsAccepted = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "ingestor",
		Name:      "events_accepted_total",
		Help:      "Events accepted by the ingestor HTTP receiver, labeled by provider.",
	}, []string{"provider"})

	EventsRejected = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "ingestor",
		Name:      "events_rejected_total",
		Help:      "Events rejected by the ingestor HTTP receiver, labeled by provider and reason.",
	}, []string{"provider", "reason"})

	BlocksAppended = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "writer",
		Name:      "blocks_appended_total",
		Help:      "Hashchain blocks appended by the writer, labeled by source.",
	}, []string{"source"})

	EventsDuplicate = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "writer",
		Name:      "events_duplicate_total",
		Help:      "Events skipped as duplicates by the writer, labeled by source.",
	}, []string{"source"})

	EventsProcessingFailed = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "writer",
		Name:      "events_processing_failed_total",
		Help:      "Events that failed processing and were dead-lettered, labeled by source.",
	}, []string{"source"})

	EventsReclaimed = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "ernest",
		Subsystem: "writer",
		Name:      "events_reclaimed_total",
		Help:      "Pending stream entries reclaimed from crashed or stalled consumers via XAUTOCLAIM.",
	})
)

// knownSources bounds the "source" label to the fixed set of built-in connectors. The
// generic /events endpoint lets callers self-report an arbitrary source string via a
// header or payload field; without this allowlist, a caller could mint one Prometheus
// time series per request (accidentally or as a metrics-cardinality DoS) and exhaust the
// memory of this process or of whatever scrapes it.
var knownSources = map[string]bool{
	"huggingface": true, "sagemaker": true, "azureml": true, "databricks": true,
	"vertexai": true, "openlineage": true, "opentelemetry": true, "cloudevents": true,
}

// SafeSourceLabel collapses any source outside the known connector set to "other" so
// metric cardinality stays bounded regardless of what a caller sends.
func SafeSourceLabel(source string) string {
	if knownSources[source] {
		return source
	}
	return "other"
}

// Serve starts a dedicated metrics HTTP server on addr, exposing /metrics. It is
// intentionally separate from the public ingest listener so scraping never shares a
// port, a rate-limit bucket, or an auth boundary with untrusted event traffic. It blocks
// until ctx is canceled.
func Serve(ctx context.Context, addr string) error {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("metrics listening on %s/metrics", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
