import { createHash, randomBytes } from 'crypto';
import { AccessTokenRole } from './access-token.schema';

const ROLE_PREFIX: Record<AccessTokenRole, string> = {
  'read-write': 'ernest_rw_',
  'read-only': 'ernest_ro_',
};

/** Hashed at rest -- only the caller who receives the return value ever sees the raw token. */
export function generateToken(role: AccessTokenRole): { token: string; tokenHash: string } {
  const token = ROLE_PREFIX[role] + randomBytes(24).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
