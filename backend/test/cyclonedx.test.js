const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCycloneDxMlBom } = require('../dist/blockchain/cyclonedx');

function block(overrides = {}) {
  return {
    blockIndex: 0,
    timestamp: '2026-07-02T09:00:00.000Z',
    type: 'model_registration',
    modelId: 'credit-risk-logreg',
    blockHash: 'hash-0',
    previousHash: '0',
    ...overrides,
  };
}

test('produces a well-formed CycloneDX 1.6 envelope', () => {
  const provenance = {
    modelId: 'credit-risk-logreg',
    totalBlocks: 1,
    chainValid: true,
    verificationErrors: [],
    history: [block({ modelName: 'Credit Risk Logistic Regression', version: '3' })],
  };

  const bom = buildCycloneDxMlBom(provenance);

  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.6');
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(bom.version, 1);
  assert.equal(bom.components.length, 1);

  const component = bom.components[0];
  assert.equal(component.type, 'machine-learning-model');
  assert.equal(component.name, 'Credit Risk Logistic Regression');
  assert.equal(component.version, '3');
  assert.equal(component['bom-ref'], 'urn:ernest:model:credit-risk-logreg');
});

test('includes a SHA-256 hash only when modelHash looks like valid hex', () => {
  const validHash = 'a'.repeat(64);
  const withHash = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 1,
    chainValid: true,
    verificationErrors: [],
    history: [block({ modelHash: validHash })],
  });
  assert.deepEqual(withHash.components[0].hashes, [{ alg: 'SHA-256', content: validHash }]);

  const withoutHash = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 1,
    chainValid: true,
    verificationErrors: [],
    history: [block({ modelHash: 'not-a-real-hash' })],
  });
  assert.equal(withoutHash.components[0].hashes, undefined);

  const missingHash = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 1,
    chainValid: true,
    verificationErrors: [],
    history: [block()],
  });
  assert.equal(missingHash.components[0].hashes, undefined);
});

test('flattens block metrics into modelCard.quantitativeAnalysis.performanceMetrics', () => {
  const bom = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 2,
    chainValid: true,
    verificationErrors: [],
    history: [
      block({ blockIndex: 0, type: 'model_registration' }),
      block({ blockIndex: 1, type: 'model_evaluation', metrics: { accuracy: 0.91, f1_score: 0.88 } }),
    ],
  });

  const metrics = bom.components[0].modelCard.quantitativeAnalysis.performanceMetrics;
  assert.equal(metrics.length, 2);
  assert.deepEqual(new Set(metrics.map(m => m.type)), new Set(['accuracy', 'f1_score']));
  assert.ok(metrics.every(m => typeof m.value === 'string'));
});

test('collects dataset_linked blocks into modelCard.modelParameters.datasets, deduplicated', () => {
  const bom = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 2,
    chainValid: true,
    verificationErrors: [],
    history: [
      block({ blockIndex: 0, type: 'dataset_linked', metadata: { datasetName: 'loan_features', datasetUri: 's3://bucket/loan' } }),
      block({ blockIndex: 1, type: 'dataset_linked', metadata: { datasetName: 'loan_features', datasetUri: 's3://bucket/loan' } }),
    ],
  });

  const datasets = bom.components[0].modelCard.modelParameters.datasets;
  assert.equal(datasets.length, 1);
  assert.equal(datasets[0].name, 'loan_features');
  assert.equal(datasets[0].contents.url, 's3://bucket/loan');
});

test('deduplicates git commits into pedigree.commits', () => {
  const bom = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 2,
    chainValid: true,
    verificationErrors: [],
    history: [
      block({ blockIndex: 0, gitCommit: 'abc123' }),
      block({ blockIndex: 1, gitCommit: 'abc123' }),
    ],
  });

  assert.deepEqual(bom.components[0].pedigree.commits, [{ uid: 'abc123' }]);
});

test('handles a model with no history without crashing or fabricating data', () => {
  const bom = buildCycloneDxMlBom({
    modelId: 'unknown-model',
    totalBlocks: 0,
    chainValid: true,
    verificationErrors: [],
    history: [],
  });

  const component = bom.components[0];
  assert.equal(component.name, 'unknown-model');
  assert.equal(component.version, 'unknown');
  assert.equal(component.hashes, undefined);
  assert.equal(component.modelCard, undefined);
  assert.equal(component.pedigree, undefined);
});

test('carries ernest-specific traceability fields as properties, not fabricated schema fields', () => {
  const bom = buildCycloneDxMlBom({
    modelId: 'm1',
    totalBlocks: 3,
    chainValid: false,
    verificationErrors: ['Block 2: Hashchain broken'],
    history: [block({ blockIndex: 2, blockHash: 'hash-2' })],
  });

  const props = Object.fromEntries(bom.components[0].properties.map(p => [p.name, p.value]));
  assert.equal(props['ernest:modelId'], 'm1');
  assert.equal(props['ernest:chainValid'], 'false');
  assert.equal(props['ernest:eventCount'], '3');
  assert.equal(props['ernest:blockIndex'], '2');
  assert.equal(props['ernest:blockHash'], 'hash-2');
});
