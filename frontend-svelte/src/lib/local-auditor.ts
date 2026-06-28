export type RiskLevel = 'low' | 'medium' | 'high';

export interface AuditFinding {
  level: RiskLevel;
  title: string;
  detail: string;
}

export interface LocalAuditReport {
  score: number;
  summary: string;
  findings: AuditFinding[];
  evidenceChecks: EvidenceCheck[];
  missingEvidence: string[];
  recommendedActions: string[];
  evidencePacket: string;
  eventCount: number;
  inferenceCount: number;
  modelRegistrationCount: number;
  scoreBreakdown: ScoreBreakdownItem[];
}

export interface EvidenceCheck {
  key: string;
  label: string;
  source: string;
  status: 'present' | 'missing' | 'warning';
  detail: string;
}

export interface ScoreBreakdownItem {
  label: string;
  value: number;
  max: number;
  detail: string;
}

interface AuditInput {
  model: any;
  provenance: any;
  stats: any;
  verification: any;
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export function getModelId(model: any): string {
  return String(model?.modelId ?? model?.id ?? model?._id ?? 'unknown-model');
}

export function normalizeProvenanceEvents(provenance: any): any[] {
  if (Array.isArray(provenance)) return provenance;

  const record = asRecord(provenance);
  for (const key of ['blocks', 'events', 'history', 'items', 'data', 'provenance']) {
    if (Array.isArray(record[key])) return record[key];
  }

  if (Array.isArray(record.chain?.blocks)) return record.chain.blocks;
  if (Array.isArray(record.result?.blocks)) return record.result.blocks;

  return [];
}

export function buildLocalAuditReport(input: AuditInput): LocalAuditReport {
  const model = asRecord(input.model);
  const stats = asRecord(input.stats);
  const verification = asRecord(input.verification);
  const events = normalizeProvenanceEvents(input.provenance);
  const modelId = getModelId(model);
  const registration = events.find((event) => event?.type === 'model_registration' || event?.data?.type === 'model_registration') ?? model;
  const inferenceEvents = events.filter((event) => event?.type === 'inference' || event?.data?.type === 'inference');
  const registrationData = asRecord(registration?.data ?? registration);
  const mlflow = asRecord(model.mlflow ?? registrationData.mlflow);
  const modelHash = mlflow.modelHash ?? model.modelHash ?? registrationData.modelHash;
  const gitCommit = mlflow.gitCommit ?? model.gitCommit ?? registrationData.gitCommit;
  const metadata = asRecord(model.metadata ?? registrationData.metadata);
  const metrics = asRecord(model.metrics ?? registrationData.metrics);
  const modelRegistrationCount = events.filter((event) => event?.type === 'model_registration' || event?.data?.type === 'model_registration').length;
  const latestAnchor = stats.latestAnchor ?? stats.lastAnchor ?? stats.anchor;
  const findings: AuditFinding[] = [];
  const evidenceChecks: EvidenceCheck[] = [];
  const scoreBreakdown: ScoreBreakdownItem[] = [];
  const missingEvidence: string[] = [];
  const recommendedActions: string[] = [];
  let score = 100;

  const chainValid = verification.isValid ?? verification.valid ?? stats.chainValid;
  evidenceChecks.push({
    key: 'model-registration',
    label: 'Model registration',
    source: 'Ernest hashchain',
    status: modelRegistrationCount > 0 || registrationData.type === 'model_registration' ? 'present' : 'missing',
    detail: modelRegistrationCount > 0 ? `${modelRegistrationCount} registration event(s)` : 'No registration event was found in provenance'
  });
  evidenceChecks.push({
    key: 'artifact-hash',
    label: 'Artifact hash',
    source: 'MLflow or source registry',
    status: modelHash ? 'present' : 'missing',
    detail: modelHash ? String(modelHash) : 'Missing modelHash evidence'
  });
  evidenceChecks.push({
    key: 'git-commit',
    label: 'Code commit',
    source: 'Git / MLflow tag',
    status: gitCommit ? 'present' : 'missing',
    detail: gitCommit ? String(gitCommit) : 'Missing gitCommit evidence'
  });
  evidenceChecks.push({
    key: 'metrics',
    label: 'Model metrics',
    source: 'MLflow or training job',
    status: Object.keys(metrics).length > 0 ? 'present' : 'missing',
    detail: Object.keys(metrics).length > 0 ? `${Object.keys(metrics).length} metric(s)` : 'No metrics found'
  });
  evidenceChecks.push({
    key: 'inference',
    label: 'Inference trace',
    source: 'Serving application',
    status: inferenceEvents.length > 0 ? 'present' : 'warning',
    detail: `${inferenceEvents.length} inference event(s)`
  });
  evidenceChecks.push({
    key: 'chain',
    label: 'Hashchain integrity',
    source: 'Ernest verifier',
    status: chainValid === true ? 'present' : chainValid === false ? 'missing' : 'warning',
    detail: chainValid === true ? 'Chain verification passed' : chainValid === false ? 'Chain verification failed' : 'Verification result unavailable'
  });
  evidenceChecks.push({
    key: 'anchor',
    label: 'Blockchain anchor',
    source: 'Local chain or Sepolia',
    status: latestAnchor ? 'present' : 'warning',
    detail: latestAnchor ? `Anchored through chain ${latestAnchor.chainId ?? 'unknown'}` : 'No anchor found'
  });

  if (chainValid === false) {
    findings.push({
      level: 'high',
      title: 'Hashchain verification failed',
      detail: 'The local chain verifier reports invalid block hashes or previous-hash links.'
    });
    recommendedActions.push('Stop relying on this evidence set until the broken chain segment is isolated and reconstructed from trusted backups.');
    score -= 35;
  } else if (chainValid !== true) {
    findings.push({
      level: 'medium',
      title: 'Hashchain verification unavailable',
      detail: 'The auditor could not confirm a positive chain verification result from the API response.'
    });
    recommendedActions.push('Run the backend `/api/verify` endpoint and include the result in the evidence packet.');
    score -= 12;
  }

  if (!latestAnchor) {
    findings.push({
      level: 'medium',
      title: 'No public anchor detected',
      detail: 'The local evidence is tamper-evident, but no latest Sepolia anchor was present in chain stats.'
    });
    recommendedActions.push('Anchor the current Merkle root before sharing evidence with external reviewers.');
    score -= 10;
  }

  if (!modelHash) {
    missingEvidence.push('MLflow or artifact model hash');
    score -= 12;
  }
  if (!gitCommit) {
    missingEvidence.push('Git commit for the model-producing code');
    score -= 8;
  }
  if (Object.keys(metrics).length === 0) {
    missingEvidence.push('Model quality metrics');
    score -= 8;
  }
  if (!metadata.organizationId && !metadata.owner && !metadata.sourceSystem) {
    missingEvidence.push('Owner, organization, or source-system metadata');
    score -= 7;
  }
  if (inferenceEvents.length === 0) {
    findings.push({
      level: 'medium',
      title: 'No inference evidence',
      detail: 'The model has registration evidence, but no inference hashes were found for decision traceability.'
    });
    recommendedActions.push('Log at least one representative inference event with input and output hashes.');
    score -= 10;
  }

  if (missingEvidence.length > 0) {
    findings.push({
      level: missingEvidence.length > 2 ? 'high' : 'medium',
      title: 'Evidence packet is incomplete',
      detail: `Missing: ${missingEvidence.join(', ')}.`
    });
    recommendedActions.push('Add the missing metadata at source and re-register the model version as a new lifecycle event.');
  }

  if (findings.length === 0) {
    findings.push({
      level: 'low',
      title: 'Evidence packet is coherent',
      detail: 'The model has registration evidence, chain verification, and no obvious metadata gaps in the current checks.'
    });
    recommendedActions.push('Export the provenance packet and attach it to the pilot review.');
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  scoreBreakdown.push(
    {
      label: 'Identity and lineage',
      value: (modelHash ? 18 : 6) + (gitCommit ? 12 : 4),
      max: 30,
      detail: 'Artifact hash and source commit evidence.'
    },
    {
      label: 'Model quality context',
      value: Object.keys(metrics).length > 0 ? 20 : 8,
      max: 20,
      detail: 'Training or registry metrics available for review.'
    },
    {
      label: 'Decision traceability',
      value: inferenceEvents.length > 0 ? 20 : 8,
      max: 20,
      detail: 'Inference hashes linking model use to later decisions.'
    },
    {
      label: 'Integrity controls',
      value: (chainValid === true ? 20 : chainValid === false ? 0 : 10) + (latestAnchor ? 10 : 4),
      max: 30,
      detail: 'Hashchain verification and optional blockchain anchor.'
    }
  );
  const summary = clampedScore >= 80
    ? 'This model is ready for an alpha evidence review.'
    : clampedScore >= 55
      ? 'This model is reviewable, but the evidence packet needs follow-up before external presentation.'
      : 'This model should not be used as the primary demo evidence until high-priority gaps are resolved.';

  const evidencePacket = [
    `# Ernest Audit Readiness: ${modelId}`,
    '',
    `Score: ${clampedScore}/100`,
    `Summary: ${summary}`,
    `Events: ${events.length}`,
    `Inference events: ${inferenceEvents.length}`,
    `Chain valid: ${String(chainValid ?? 'unknown')}`,
    `Latest anchor: ${latestAnchor ? JSON.stringify(latestAnchor) : 'none'}`,
    '',
    '## Findings',
    ...findings.map((finding) => `- [${finding.level.toUpperCase()}] ${finding.title}: ${finding.detail}`),
    '',
    '## Evidence Checks',
    ...evidenceChecks.map((check) => `- [${check.status.toUpperCase()}] ${check.label} (${check.source}): ${check.detail}`),
    '',
    '## Missing Evidence',
    ...(missingEvidence.length > 0 ? missingEvidence.map((item) => `- ${item}`) : ['- None detected by local checks']),
    '',
    '## Recommended Actions',
    ...recommendedActions.map((action) => `- ${action}`),
    '',
    '## Model Snapshot',
    '```json',
    JSON.stringify(model, null, 2),
    '```'
  ].join('\n');

  return {
    score: clampedScore,
    summary,
    findings,
    evidenceChecks,
    missingEvidence,
    recommendedActions,
    evidencePacket,
    eventCount: events.length,
    inferenceCount: inferenceEvents.length,
    modelRegistrationCount,
    scoreBreakdown
  };
}

export function buildWebLlmPrompt(model: any, report: LocalAuditReport): string {
  return [
    'You are an AI governance reviewer. Write a concise audit memo for an alpha PoC evaluation.',
    'Use only the evidence below. Do not claim production compliance.',
    '',
    report.evidencePacket,
    '',
    'Return four sections: Executive readout, Key risks, Recommended next steps, Incubator demo angle.'
  ].join('\n');
}
