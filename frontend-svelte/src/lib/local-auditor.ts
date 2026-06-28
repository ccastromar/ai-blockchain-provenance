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
  missingEvidence: string[];
  recommendedActions: string[];
  evidencePacket: string;
  eventCount: number;
  inferenceCount: number;
}

interface AuditInput {
  model: any;
  provenance: any;
  stats: any;
  verification: any;
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

export function getModelId(model: any): string {
  return String(model?.modelId ?? model?.id ?? model?._id ?? 'unknown-model');
}

export function normalizeProvenanceEvents(provenance: any): any[] {
  if (Array.isArray(provenance)) return provenance;

  const record = asRecord(provenance);
  for (const key of ['blocks', 'events', 'items', 'data', 'provenance']) {
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
  const mlflow = asRecord(model.mlflow ?? registration?.mlflow ?? registration?.data?.mlflow);
  const metadata = asRecord(model.metadata ?? registration?.metadata ?? registration?.data?.metadata);
  const metrics = asRecord(model.metrics ?? registration?.metrics ?? registration?.data?.metrics);
  const findings: AuditFinding[] = [];
  const missingEvidence: string[] = [];
  const recommendedActions: string[] = [];
  let score = 100;

  const chainValid = verification.isValid ?? verification.valid ?? stats.chainValid;
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

  const latestAnchor = stats.latestAnchor ?? stats.lastAnchor ?? stats.anchor;
  if (!latestAnchor) {
    findings.push({
      level: 'medium',
      title: 'No public anchor detected',
      detail: 'The local evidence is tamper-evident, but no latest Sepolia anchor was present in chain stats.'
    });
    recommendedActions.push('Anchor the current Merkle root before sharing evidence with external reviewers.');
    score -= 10;
  }

  if (!mlflow.modelHash) {
    missingEvidence.push('MLflow or artifact model hash');
    score -= 12;
  }
  if (!mlflow.gitCommit) {
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
  const summary = clampedScore >= 80
    ? 'This model is ready for an alpha evidence review.'
    : clampedScore >= 55
      ? 'This model is reviewable, but the evidence packet needs follow-up before external presentation.'
      : 'This model should not be used as the primary demo evidence until high-priority gaps are resolved.';

  const evidencePacket = [
    `# Ernest Local Audit: ${modelId}`,
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
    missingEvidence,
    recommendedActions,
    evidencePacket,
    eventCount: events.length,
    inferenceCount: inferenceEvents.length
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
