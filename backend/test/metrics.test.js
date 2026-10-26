const assert = require('node:assert/strict');
const test = require('node:test');
const { metrics } = require('@opentelemetry/api');
const m = require('../dist/metrics');

// A meter provider that remembers what the instruments were given.
function recordingProvider() {
  const seen = { counters: {}, histograms: {} };
  const instrument = (kind, name, options) => ({
    options,
    add: (value, attributes) => (seen.counters[name] ||= []).push({ value, attributes }),
    record: (value, attributes) => (seen.histograms[name] ||= []).push({ value, attributes, options }),
  });
  const meter = {
    createCounter: (name, options) => instrument('counter', name, options),
    createHistogram: (name, options) => instrument('histogram', name, options),
  };
  return { seen, provider: { getMeter: () => meter } };
}

function install() {
  const { seen, provider } = recordingProvider();
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);
  m.resetMetricsForTest();
  return seen;
}

test('received evidence is counted by a bounded source and its outcome', () => {
  const seen = install();
  m.evidenceReceived('prudence-pdp', 'recorded');
  m.evidenceReceived('someone-made-this-up-123', 'duplicate');
  assert.deepEqual(seen.counters['ernest.evidence.received'].map((c) => c.attributes), [
    { source: 'prudence-pdp', outcome: 'recorded' },
    { source: 'other', outcome: 'duplicate' },
  ]);
});

test('the chaining delay is the time from acceptance, in seconds, in the objectives buckets', () => {
  const seen = install();
  m.evidenceChained(new Date(10_000), 12_500);
  m.evidenceChained(undefined);
  const [obs] = seen.histograms['ernest.evidence.chaining.delay'];
  assert.equal(seen.histograms['ernest.evidence.chaining.delay'].length, 1);
  assert.equal(obs.value, 2.5);
  assert.equal(obs.options.unit, 's');
  assert.deepEqual(obs.options.advice.explicitBucketBoundaries, m.CHAINING_BUCKETS);
});

test('a chain check that finds the chain broken is invalid, a failure is a failure', async () => {
  const seen = install();
  await m.timeProof('verify', async () => ({ isValid: false }), (r) => r.isValid === false);
  await m.timeProof('generate', async () => ({ status: 'chained' }));
  await assert.rejects(m.timeProof('verify', async () => { throw new Error('mongo down'); }));
  assert.deepEqual(seen.histograms['ernest.proof.duration'].map((h) => h.attributes), [
    { operation: 'verify', outcome: 'invalid' },
    { operation: 'generate', outcome: 'success' },
    { operation: 'verify', outcome: 'failure' },
  ]);
});
