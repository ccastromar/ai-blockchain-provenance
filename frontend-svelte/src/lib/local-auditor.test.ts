import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLocalAuditReport,
  normalizeProvenanceEvents
} from './local-auditor.ts';

const completeModel = {
  modelId: 'iris-classifier-v1',
  modelName: 'Iris classifier',
  version: '1.0.0',
  metrics: { accuracy: 0.97 },
  metadata: { sourceSystem: 'mlflow', owner: 'ai-platform' }
};

const registrationEvent = {
  type: 'model_registration',
  modelId: 'iris-classifier-v1',
  modelName: 'Iris classifier',
  version: '1.0.0',
  modelHash: 'a'.repeat(64),
  gitCommit: 'b'.repeat(12),
  metrics: { accuracy: 0.97 },
  metadata: { sourceSystem: 'mlflow', owner: 'ai-platform' }
};

const inferenceEvent = {
  type: 'inference',
  modelId: 'iris-classifier-v1',
  inferenceId: 'inf-1',
  inputHash: 'c'.repeat(64),
  outputHash: 'd'.repeat(64)
};

describe('normalizeProvenanceEvents', () => {
  it('accepts backend history responses', () => {
    assert.deepEqual(
      normalizeProvenanceEvents({ history: [registrationEvent, inferenceEvent] }),
      [registrationEvent, inferenceEvent]
    );
  });
});

describe('buildLocalAuditReport', () => {
  it('scores complete model evidence as review-ready', () => {
    const report = buildLocalAuditReport({
      model: completeModel,
      provenance: { history: [registrationEvent, inferenceEvent] },
      stats: { chainValid: true, lastAnchor: { chainId: 31337 } },
      verification: { isValid: true, errors: [] }
    });

    assert.equal(report.score, 100);
    assert.equal(report.eventCount, 2);
    assert.equal(report.inferenceCount, 1);
    assert.equal(report.modelRegistrationCount, 1);
    assert.equal(report.missingEvidence.length, 0);
    assert.equal(report.evidenceChecks.find((check) => check.key === 'artifact-hash')?.status, 'present');
    assert.match(report.summary, /ready/i);
  });

  it('penalizes missing artifact, commit, metrics, owner, inference, and anchor evidence', () => {
    const report = buildLocalAuditReport({
      model: { modelId: 'thin-model', metadata: {} },
      provenance: { history: [{ type: 'model_registration', modelId: 'thin-model' }] },
      stats: { chainValid: true },
      verification: { isValid: true, errors: [] }
    });

    assert.equal(report.score, 45);
    assert.deepEqual(report.missingEvidence, [
      'MLflow or artifact model hash',
      'Git commit for the model-producing code',
      'Model quality metrics',
      'Owner, organization, or source-system metadata'
    ]);
    assert.equal(report.evidenceChecks.find((check) => check.key === 'inference')?.status, 'warning');
    assert.equal(report.evidenceChecks.find((check) => check.key === 'anchor')?.status, 'warning');
  });

  it('marks chain verification failures as high risk', () => {
    const report = buildLocalAuditReport({
      model: completeModel,
      provenance: { history: [registrationEvent, inferenceEvent] },
      stats: { chainValid: false, lastAnchor: { chainId: 31337 } },
      verification: { isValid: false, errors: ['Block 1 hash mismatch'] }
    });

    assert.equal(report.score, 65);
    assert.equal(report.evidenceChecks.find((check) => check.key === 'chain')?.status, 'missing');
    assert.equal(report.findings[0]?.level, 'high');
  });
});
