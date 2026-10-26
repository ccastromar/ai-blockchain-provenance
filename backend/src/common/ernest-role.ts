/**
 * Process roles (CQRS split of one Ernest deployment), from ERNEST_ROLE — a comma list of:
 *
 * - `reader`  — serves the read API. Any number of replicas; no writes, no background jobs.
 * - `writer`  — accepts submissions (models, inferences, admin writes). With batching on it
 *               only inserts events, so writers scale out too.
 * - `chainer` — the only chain writer: the ADR-004 batcher (lease-coordinated), anchoring and
 *               the integrity check. Run one (more are safe: the lease picks a leader).
 *
 * Unset or `all` keeps today's single-process behaviour (all three roles).
 */
export type ErnestRole = 'reader' | 'writer' | 'chainer';

const ALL: ErnestRole[] = ['reader', 'writer', 'chainer'];

export function ernestRoles(raw: string | undefined = process.env.ERNEST_ROLE): Set<ErnestRole> {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'all') return new Set(ALL);
  const roles = new Set<ErnestRole>();
  for (const part of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (part === 'all') return new Set(ALL);
    if (!(ALL as string[]).includes(part)) {
      throw new Error(`ERNEST_ROLE: unknown role '${part}' (expected reader, writer, chainer or all)`);
    }
    roles.add(part as ErnestRole);
  }
  if (roles.size === 0) throw new Error('ERNEST_ROLE is empty');
  return roles;
}

export function hasRole(role: ErnestRole): boolean {
  return ernestRoles().has(role);
}

/** True when this process may write to MongoDB at all (indexes, genesis, submissions). */
export function writesAllowed(): boolean {
  const roles = ernestRoles();
  return roles.has('writer') || roles.has('chainer');
}

/**
 * Fail closed on a split that cannot hold: without batching, every submission appends a block
 * in the request path, so a writer that is not also the chainer would be a second chain
 * writer racing the first.
 */
export function assertRolesConsistent(): void {
  const roles = ernestRoles();
  // Same reading as EvidenceService: `events` unless EVIDENCE_BATCHING says off or on.
  const raw = (process.env.EVIDENCE_BATCHING || '').trim().toLowerCase();
  const batching = raw === 'off' || raw === 'on' ? raw : 'events';
  if (roles.has('writer') && !roles.has('chainer') && batching === 'off') {
    throw new Error(
      'ERNEST_ROLE=writer without chainer needs EVIDENCE_BATCHING=events|on: with batching off a ' +
        'writer appends blocks itself and would race the chainer');
  }
}
