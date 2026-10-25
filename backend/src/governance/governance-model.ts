import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

// Governance functions (Chestertown contract v1, ./contract/README.md): which functions each IdP
// group or role grants, validated against the contract's rules and floors. ./contract is a copy
// synced from prudence-governance; do not edit it here.

export const MODEL_VERSION = 'chestertown.governance/v1';

type Kind = 'person' | 'machine';

// contract/README.md, section 2.
const FUNCTIONS: Record<string, { kind: Kind; apps: string[] }> = {
  'system.declare': { kind: 'person', apps: ['prudence'] },
  'system.approve': { kind: 'person', apps: ['prudence'] },
  'policy.author': { kind: 'person', apps: ['prudence'] },
  'policy.approve': { kind: 'person', apps: ['prudence'] },
  oversight: { kind: 'person', apps: ['aos', 'prudence'] },
  'incident.handle': { kind: 'person', apps: ['prudence'] },
  'ai.use': { kind: 'person', apps: ['aos'] },
  'evidence.write': { kind: 'person', apps: ['ernest'] },
  audit: { kind: 'person', apps: ['aos', 'prudence', 'ernest'] },
  'platform.admin': { kind: 'person', apps: ['aos', 'prudence', 'ernest'] },
  'runtime.decide': { kind: 'machine', apps: ['prudence'] },
  'runtime.report': { kind: 'machine', apps: ['prudence'] },
};
const APPS = ['aos', 'prudence', 'ernest'];
const TIERS = ['HIGH', 'LIMITED', 'MINIMAL'];
const ACCOUNTABILITIES = ['OWNER', 'SUPERVISOR', 'COMPLIANCE', 'DPO', 'SECURITY'];
const GRANT = /^([a-z]+(?:\.[a-z]+)?)(?::([a-z0-9][a-z0-9_-]*|\*))?(?:@([a-z]+))?$/;

/** An invalid model; `code` is the contract's error code. */
export class GovernanceModelError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
  }
}

interface Grant {
  fn: string;
  domain?: string;
  app?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseGrant(raw: unknown): Grant {
  if (typeof raw !== 'string') throw new GovernanceModelError('grant.syntax', String(raw));
  const m = GRANT.exec(raw);
  if (!m) throw new GovernanceModelError('grant.syntax', raw);
  const [, fn, domain, app] = m;
  const spec = FUNCTIONS[fn];
  if (!spec) throw new GovernanceModelError('grant.unknown_function', raw);
  if (domain !== undefined && fn !== 'ai.use') throw new GovernanceModelError('grant.domain_not_allowed', raw);
  if (domain === undefined && fn === 'ai.use') throw new GovernanceModelError('grant.domain_required', raw);
  if (app !== undefined) {
    if (!APPS.includes(app)) throw new GovernanceModelError('grant.unknown_app', raw);
    if (!spec.apps.includes(app)) throw new GovernanceModelError('grant.app_not_applicable', raw);
  }
  return { fn, domain, app };
}

function claimOf(identity: unknown, kind: string): string {
  const section = isObject(identity) ? identity[kind] : undefined;
  const claim = isObject(section) ? section.claim : undefined;
  if (typeof claim !== 'string' || claim === '') {
    throw new GovernanceModelError('model.identity', `identity.${kind}.claim`);
  }
  return claim;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function validateApprovals(raw: unknown): void {
  if (raw !== undefined && raw !== null && !isObject(raw)) {
    throw new GovernanceModelError('rules.approvals', 'approvals must be an object');
  }
  const approvals = isObject(raw) ? raw : {};
  for (const [tier, rule] of Object.entries(approvals)) {
    const count = isObject(rule) ? rule.count : undefined;
    if (!TIERS.includes(tier) || !isCount(count) || count < 1) {
      throw new GovernanceModelError('rules.approvals', tier);
    }
  }
  const high = approvals.HIGH;
  if (!isObject(high) || !isCount(high.count) || high.count < 2 || high.distinct !== true) {
    throw new GovernanceModelError('floor.approvals.HIGH', 'HIGH needs count >= 2 and distinct: true');
  }
}

const isPersonFunction = (v: unknown): boolean => typeof v === 'string' && FUNCTIONS[v]?.kind === 'person';

function validateIncompatible(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (!Array.isArray(raw)) throw new GovernanceModelError('rules.incompatible', 'incompatible must be a list');
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isPersonFunction(pair[0]) || !isPersonFunction(pair[1]) || pair[0] === pair[1]) {
      throw new GovernanceModelError('rules.incompatible', JSON.stringify(pair));
    }
  }
}

function validateAccountable(raw: unknown): void {
  if (raw !== undefined && raw !== null && !isObject(raw)) {
    throw new GovernanceModelError('rules.accountable', 'accountable must be an object');
  }
  const accountable = isObject(raw) ? raw : {};
  for (const [tier, roles] of Object.entries(accountable)) {
    if (!TIERS.includes(tier) || !Array.isArray(roles) || !roles.every((r) => ACCOUNTABILITIES.includes(r))) {
      throw new GovernanceModelError('rules.accountable', tier);
    }
  }
  const high = accountable.HIGH;
  if (!Array.isArray(high) || !high.includes('SUPERVISOR')) {
    throw new GovernanceModelError('floor.accountable.HIGH', 'HIGH needs SUPERVISOR');
  }
}

/** A claim's values: a dotted name walks nested objects; strings split on whitespace. */
export function claimValues(claims: Record<string, unknown>, name: string): string[] {
  let value: unknown = claims;
  for (const part of name.split('.')) {
    if (!isObject(value) || !(part in value)) return [];
    value = value[part];
  }
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/** A validated governance model. */
export class GovernanceModel {
  private constructor(
    private readonly peopleClaim: string,
    private readonly machinesClaim: string,
    private readonly grants: Map<string, Grant[]>,
  ) {}

  /** Validates a parsed model (contract/README.md, section 4); throws on the first broken rule. */
  static of(model: unknown): GovernanceModel {
    if (!isObject(model) || model.version !== MODEL_VERSION) {
      throw new GovernanceModelError('model.version', `expected ${MODEL_VERSION}`);
    }
    const people = claimOf(model.identity, 'people');
    const machines = claimOf(model.identity, 'machines');
    if (!isObject(model.map)) throw new GovernanceModelError('model.map', 'map must be an object');
    const grants = new Map<string, Grant[]>();
    for (const [key, raw] of Object.entries(model.map)) {
      if (key === '' || !Array.isArray(raw) || raw.length === 0) {
        throw new GovernanceModelError('model.map', `entry ${key}`);
      }
      const parsed = raw.map(parseGrant);
      if (new Set(parsed.map((g) => FUNCTIONS[g.fn].kind)).size > 1) {
        throw new GovernanceModelError('grant.mixed_kinds', key);
      }
      grants.set(key, parsed);
    }
    const rules = isObject(model.rules) ? model.rules : {};
    validateApprovals(rules.approvals);
    validateIncompatible(rules.incompatible);
    validateAccountable(rules.accountable);
    return new GovernanceModel(people, machines, grants);
  }

  /** Reads a YAML (or JSON) model and validates it. */
  static parse(text: string): GovernanceModel {
    return GovernanceModel.of(loadYaml(text));
  }

  /** The functions `app` grants to a token with these claims, sorted (contract/README.md, section 5). */
  resolve(claims: Record<string, unknown>, app: string): string[] {
    const granted = new Set<string>();
    const collect = (values: string[], kind: Kind) => {
      for (const value of values) {
        for (const g of this.grants.get(value) ?? []) {
          const spec = FUNCTIONS[g.fn];
          if (spec.kind !== kind || !spec.apps.includes(app) || (g.app !== undefined && g.app !== app)) continue;
          granted.add(g.domain !== undefined ? `${g.fn}:${g.domain}` : g.fn);
        }
      }
    };
    collect(claimValues(claims, this.peopleClaim), 'person');
    collect(claimValues(claims, this.machinesClaim), 'machine');
    return [...granted].sort();
  }
}

let configured: GovernanceModel | undefined;

/**
 * The organization's model (ERNEST_GOVERNANCE_MODEL), or the contract's default one, which
 * reproduces Ernest's read-write / read-only roles. Read once; an invalid model throws, so Ernest
 * does not start with it.
 */
export function governanceModel(): GovernanceModel {
  if (!configured) {
    const path = process.env.ERNEST_GOVERNANCE_MODEL?.trim() || join(__dirname, 'contract', 'default-model.yaml');
    configured = GovernanceModel.parse(readFileSync(path, 'utf8'));
  }
  return configured;
}
