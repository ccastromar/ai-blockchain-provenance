import { timingSafeKeyMatch } from '../common/key-match.util';
import { AccessTokenService } from './access-token.service';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous';

export interface ResolvedAccess {
  role: ErnestRole;
  label?: string;
  // OIDC subject (the IdP `sub`) when the caller was authenticated via a bearer token.
  // Present only for the OIDC path; absent for static keys and Mongo tokens.
  subject?: string;
  // Governance functions in Ernest (contract v1); OIDC path only.
  functions?: string[];
}

// Structural type to avoid a circular import with oidc.service.ts (which imports ErnestRole
// from here). Any object with these members satisfies it -- in practice, OidcService.
export interface OidcResolver {
  readonly enabled: boolean;
  verify(bearer: string | undefined): Promise<{ role: ErnestRole; subject: string; label?: string; functions?: string[] } | null>;
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
  if (opts.oidc?.enabled && opts.bearer) {
    const principal = await opts.oidc.verify(opts.bearer);
    // A valid token that maps to no usable role falls through, so a caller may still
    // present an API key alongside it; an invalid token (null) falls through too.
    if (principal && principal.role !== 'anonymous') {
      return { role: principal.role, label: principal.label, subject: principal.subject, functions: principal.functions };
    }
  }

  const writeKey = process.env.ERNEST_API_KEY;
  const readKey = process.env.ERNEST_READ_API_KEY;

  if (writeKey && timingSafeKeyMatch(actualKey, writeKey)) return { role: 'read-write' };
  if (readKey && timingSafeKeyMatch(actualKey, readKey)) return { role: 'read-only' };

  if (actualKey) {
    const resolved = await tokenService.resolve(actualKey);
    if (resolved) return { role: resolved.role, label: resolved.label };
  }

  return { role: 'anonymous' };
}

/** Extracts the raw token from an `Authorization: Bearer <token>` header value. */
export function bearerFrom(authorizationHeader: unknown): string | undefined {
  const value = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : undefined;
}
