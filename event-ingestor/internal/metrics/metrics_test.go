package metrics

import "testing"

func TestSafeSourceLabelPassesThroughKnownSources(t *testing.T) {
	for _, source := range []string{
		"huggingface", "sagemaker", "azureml", "databricks",
		"vertexai", "openlineage", "opentelemetry", "cloudevents",
	} {
		if got := SafeSourceLabel(source); got != source {
			t.Errorf("SafeSourceLabel(%q) = %q, want unchanged", source, got)
		}
	}
}

func TestSafeSourceLabelCollapsesUnknownSourcesToOther(t *testing.T) {
	for _, source := range []string{
		"manual-normalizer-test", "random-local-emitter", "", "anything-a-caller-makes-up",
	} {
		if got := SafeSourceLabel(source); got != "other" {
			t.Errorf("SafeSourceLabel(%q) = %q, want %q", source, got, "other")
		}
	}
}
