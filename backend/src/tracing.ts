// OpenTelemetry tracing (Chestertown observability conventions). Imported first by main.ts, so
// the HTTP, Express, Nest and MongoDB instrumentations patch their modules before Nest loads
// them.
//
// Configured by the standard OTEL_* variables. Without OTEL_EXPORTER_OTLP_ENDPOINT (or
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) nothing starts and nothing is recorded. When it runs,
// requests continue the caller's trace (Prudence and AOS send `traceparent`); spans carry
// routes and ids, never request bodies. Metrics go the same way (HTTP server durations and
// Ernest's domain metrics, src/metrics.ts); logs stay on stdout unless OTEL_LOGS_EXPORTER asks.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';

const UNTRACED = new Set(['/health', '/api/health', '/metrics']);

export function tracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.OTEL_SDK_DISABLED || '').trim().toLowerCase() === 'true') return false;
  return Boolean((env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim());
}

/** The resource defaults Ernest's backend runs with, unless the environment sets them. */
export function applyTracingDefaults(env: NodeJS.ProcessEnv = process.env): void {
  env.OTEL_SERVICE_NAME ||= 'ernest-backend';
  if (!/(^|,)\s*service\.namespace=/.test(env.OTEL_RESOURCE_ATTRIBUTES || '')) {
    env.OTEL_RESOURCE_ATTRIBUTES = ['service.namespace=chestertown', env.OTEL_RESOURCE_ATTRIBUTES]
      .filter(Boolean)
      .join(',');
  }
  env.OTEL_METRICS_EXPORTER ||= 'otlp';
  env.OTEL_LOGS_EXPORTER ||= 'none';
}

function startTracing(): void {
  if (!tracingEnabled()) return;
  applyTracingDefaults();
  const sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => UNTRACED.has((req.url || '').split('?')[0]),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      // Statement text would carry evidence content: only the operation is recorded.
      new MongoDBInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  sdk.start();
  // A signal listener replaces Node's default exit: flush what is buffered, then let the signal
  // end the process as it would have (the listener is gone by then), bounded so a collector
  // that does not answer never holds a stop.
  const shutdown = (signal: NodeJS.Signals) => {
    const exit = () => process.kill(process.pid, signal);
    const timer = setTimeout(exit, 3000);
    timer.unref();
    sdk
      .shutdown()
      .catch((err) => console.error('OpenTelemetry shutdown failed:', err?.message || err))
      .finally(() => {
        clearTimeout(timer);
        exit();
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`OpenTelemetry tracing on (${process.env.OTEL_SERVICE_NAME})`);
}

startTracing();
