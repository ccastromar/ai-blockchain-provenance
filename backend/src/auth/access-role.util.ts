import { timingSafeKeyMatch } from '../common/key-match.util';
import { AccessTokenService } from './access-token.service';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous';

export interface ResolvedAccess {
  role: ErnestRole;
  label?: string;
}

/**
 * Resolves a caller's role from the X-Ernest-Api-Key header value. Checks the static
 * env-var keys first (cheap, constant-time comparison, no DB round trip) before falling
 * back to a Mongo-backed named token -- issued per auditor/team via /api/auth/tokens --
 * so the common case (env keys or no key at all) never touches the database.
 */
export async function resolveAccess(
  actualKey: string | undefined,
  tokenService: AccessTokenService,
): Promise<ResolvedAccess> {
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
