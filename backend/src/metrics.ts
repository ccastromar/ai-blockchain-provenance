// Ernest's domain metrics (Chestertown observability conventions, section 6), exported over
// OTLP with the traces (src/tracing.ts) when OTEL_EXPORTER_OTLP_ENDPOINT is set; without it the
// instruments are no-ops. Attributes take a small fixed set of values: never an event, model
// or decision id.
//
// - ernest.evidence.received{source, outcome}: evidence submitted to the event store
//   (recorded | duplicate | conflict).
// - ernest.evidence.chaining.delay: seconds from an event's acceptance to its chaining
//   (freshness and proof readiness, F2 and F3).
// - ernest.proof.duration{operation, outcome}: an inclusion proof (generate) or a chain check
//   (verify); a check that finds the chain broken is `invalid`.
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

/** Sources whose names become a label; anything else is `other`. */
const KNOWN_SOURCES = new Set([
  'aos', 'prudence', 'prudence-pdp',
  'huggingface', 'sagemaker', 'azureml', 'databricks', 'vertexai',
  'openlineage', 'opentelemetry', 'cloudevents',
]);

/** Buckets (seconds): chaining runs every few seconds and should rarely take minutes. */
export const CHAINING_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 900, 3600];
/** Buckets (seconds) for a proof or a chain check. */
export const PROOF_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export function sourceLabel(source: string | undefined): string {
  return source && KNOWN_SOURCES.has(source) ? source : 'other';
}

// Created on first use: the global meter provider is set when tracing starts, and a meter
// taken before that would stay a no-op.
let instruments: { received: Counter; chaining: Histogram; proof: Histogram } | undefined;

function get() {
  if (!instruments) {
    const meter = metrics.getMeter('ernest-backend');
    instruments = {
      received: meter.createCounter('ernest.evidence.received', {
        description: 'Evidence submitted to the event store',
        unit: '{event}',
      }),
      chaining: meter.createHistogram('ernest.evidence.chaining.delay', {
        description: 'From acceptance to chaining of an evidence event',
        unit: 's',
        advice: { explicitBucketBoundaries: CHAINING_BUCKETS },
      }),
      proof: meter.createHistogram('ernest.proof.duration', {
        description: 'Generating an inclusion proof or verifying the chain',
        unit: 's',
        advice: { explicitBucketBoundaries: PROOF_BUCKETS },
      }),
    };
  }
  return instruments;
}

export function evidenceReceived(source: string | undefined, outcome: 'recorded' | 'duplicate' | 'conflict') {
  get().received.add(1, { source: sourceLabel(source), outcome });
}

export function evidenceChained(acceptedAt: Date | string | undefined, now = Date.now()) {
  if (!acceptedAt) return;
  const accepted = new Date(acceptedAt).getTime();
  if (Number.isNaN(accepted)) return;
  get().chaining.record(Math.max(0, (now - accepted) / 1000));
}

/** Times `work` as an `operation`; `invalid(result)` marks a result that is not a success. */
export async function timeProof<T>(
  operation: 'generate' | 'verify',
  work: () => Promise<T>,
  invalid: (result: T) => boolean = () => false,
): Promise<T> {
  const started = process.hrtime.bigint();
  let outcome = 'failure';
  try {
    const result = await work();
    outcome = invalid(result) ? 'invalid' : 'success';
    return result;
  } finally {
    get().proof.record(Number(process.hrtime.bigint() - started) / 1e9, { operation, outcome });
  }
}

/** For tests: drop the instruments so the next use takes them from the current provider. */
export function resetMetricsForTest() {
  instruments = undefined;
}
