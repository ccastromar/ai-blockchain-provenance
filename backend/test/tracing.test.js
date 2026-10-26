const assert = require('node:assert/strict');
const test = require('node:test');

// Loading the module starts tracing only with an OTLP endpoint: none here.
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const { tracingEnabled, applyTracingDefaults } = require('../dist/tracing');

test('tracing is off without an OTLP endpoint, and when the SDK is disabled', () => {
  assert.equal(tracingEnabled({}), false);
  assert.equal(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }), true);
  assert.equal(tracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces' }), true);
  assert.equal(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_SDK_DISABLED: 'true' }), false);
});

test('the backend names itself in the suite, and exports traces and metrics but not logs, unless told otherwise', () => {
  const env = {};
  applyTracingDefaults(env);
  assert.equal(env.OTEL_SERVICE_NAME, 'ernest-backend');
  assert.equal(env.OTEL_RESOURCE_ATTRIBUTES, 'service.namespace=chestertown');
  assert.equal(env.OTEL_METRICS_EXPORTER, 'otlp');
  assert.equal(env.OTEL_LOGS_EXPORTER, 'none');

  const set = {
    OTEL_SERVICE_NAME: 'ernest-eu',
    OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=production',
    OTEL_METRICS_EXPORTER: 'none',
  };
  applyTracingDefaults(set);
  assert.equal(set.OTEL_SERVICE_NAME, 'ernest-eu');
  assert.equal(set.OTEL_RESOURCE_ATTRIBUTES, 'service.namespace=chestertown,deployment.environment.name=production');
  assert.equal(set.OTEL_METRICS_EXPORTER, 'none');

  const own = { OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=acme' };
  applyTracingDefaults(own);
  assert.equal(own.OTEL_RESOURCE_ATTRIBUTES, 'service.namespace=acme');
});
