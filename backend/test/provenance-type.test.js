const assert = require('node:assert/strict');
const test = require('node:test');
const { provenanceTypeCondition } = require('../dist/blockchain/provenance-type');

const BLOCKS = { type: 'data.type', stage: 'data.metadata.stage' };

// A tiny evaluator for the conditions this filter builds ($or, $ne, equality on dotted paths).
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const matches = (doc, cond) => Object.entries(cond).every(([key, want]) => {
  if (key === '$or') return want.some((c) => matches(doc, c));
  if (want && typeof want === 'object' && '$ne' in want) return get(doc, key) !== want.$ne;
  return get(doc, key) === want;
});

const directDecision = { data: { type: 'inference', metadata: { stage: 'governance_decision' } } };
const typedDecision = { data: { type: 'policy_decision', metadata: {} } };
const execution = { data: { type: 'inference', metadata: { stage: 'execution' } } };
const plainInference = { data: { type: 'inference' } };
const registration = { data: { type: 'model_registration' } };

test('policy_decision finds decisions sent through the direct transport and typed ones', () => {
  const cond = provenanceTypeCondition('policy_decision', BLOCKS);
  assert.equal(matches(directDecision, cond), true);
  assert.equal(matches(typedDecision, cond), true);
  assert.equal(matches(execution, cond), false);
  assert.equal(matches(plainInference, cond), false);
});

test('inference no longer lists governance decisions as model inferences', () => {
  const cond = provenanceTypeCondition('inference', BLOCKS);
  assert.equal(matches(directDecision, cond), false);
  assert.equal(matches(execution, cond), true);
  assert.equal(matches(plainInference, cond), true);
});

test('other types filter on the stored type, at the path given', () => {
  assert.equal(matches(registration, provenanceTypeCondition('model_registration', BLOCKS)), true);
  assert.deepEqual(provenanceTypeCondition('external_event', { type: 'type', stage: 'data.metadata.stage' }),
    { type: 'external_event' });
});
