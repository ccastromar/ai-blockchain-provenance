import { timingSafeKeyMatch } from '../common/key-match.util';
import { AccessTokenService } from './access-token.service';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous';

// Governance functions (contract v1) behind Ernest's two credential roles: a read-write key or
// token writes evidence and administers; a read-only one audits. IdP tokens get their functions
// from the governance model instead.
export function functionsForRole(role: ErnestRole): string[] {
  if (role === 'read-write') return ['evidence.write', 'platform.admin'];
  if (role === 'read-only') return ['audit'];
  return [];
}

// The role the console shows for a set of functions: writing evidence is read-write, any other
// function reads.
export function roleForFunctions(functions: string[]): ErnestRole {
  if (functions.includes('evidence.write')) return 'read-write';
  return functions.length > 0 ? 'read-only' : 'anonymous';
}

export interface ResolvedAccess {
  role: ErnestRole;
  label?: string;
  // OIDC subject (the IdP `sub`) when the caller was authenticated via a bearer token.
  // Present only for the OIDC path; absent for static keys and Mongo tokens.
  subject?: string;
  // Governance functions in Ernest (contract v1). The guards authorize by them.
  functions: string[];
}

// Structural type to avoid a circular import with oidc.service.ts (which imports ErnestRole
// from here). Any object with these members satisfies it -- in practice, OidcService.
export interface OidcResolver {
  readonly enabled: boolean;
  verify(bearer: string | undefined): Promise<{ role: ErnestRole; subject: string; label?: string; functions: string[] } | null>;
}

export interface ResolveAccessOptions {
  // Raw bearer token value (without the "Bearer " prefix) from the Authorization header.
  bearer?: string;
  oidc?: OidcResolver;
}

/**
 * Resolves a caller's role. When OIDC is enabled and a bearer token authenticates to a
 * usable role, that identity wins (ADR-002, Decision A); otherwise it falls through to the
 * static env-var keys (cheap, constant-time, no DB round trip) and then a Mongo-backed
 * named token issued via /api/auth/tokens. The common case (env keys or no credential)
 * never touches OIDC or the database.
 */
export async function resolveAccess(
  actualKey: string | undefined,
  tokenService: AccessTokenService,
  opts: ResolveAccessOptions = {},
): Promise<ResolvedAccess> {
  // A valid token that grants no function falls through, so a caller may still present an API
  // key alongside it; an invalid token (null) falls through too. Who it names is kept, so a
  // signed-in person without a function is told so by name instead of shown as anonymous.
  let identified: { label?: string; subject?: string } = {};
  if (opts.oidc?.enabled && opts.bearer) {
    const principal = await opts.oidc.verify(opts.bearer);
    if (principal) identified = { label: principal.label, subject: principal.subject };
    if (principal && principal.functions.length > 0) {
      return { role: principal.role, label: principal.label, subject: principal.subject, functions: principal.functions };
    }
  }

  const writeKey = process.env.ERNEST_API_KEY;
  const readKey = process.env.ERNEST_READ_API_KEY;

  if (writeKey && timingSafeKeyMatch(actualKey, writeKey)) {
    return { role: 'read-write', functions: functionsForRole('read-write') };
  }
  if (readKey && timingSafeKeyMatch(actualKey, readKey)) {
    return { role: 'read-only', functions: functionsForRole('read-only') };
  }

  if (actualKey) {
    const resolved = await tokenService.resolve(actualKey);
    if (resolved) return { role: resolved.role, label: resolved.label, functions: functionsForRole(resolved.role) };
  }

  return { role: 'anonymous', functions: [], ...identified };
}

/** Extracts the raw token from an `Authorization: Bearer <token>` header value. */
export function bearerFrom(authorizationHeader: unknown): string | undefined {
  const value = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : undefined;
}
