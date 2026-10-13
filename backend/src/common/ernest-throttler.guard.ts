import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ResolvedAccess } from '../auth/access-role.util';

/**
 * Rate limiting per caller identity instead of per IP. A service client (Prudence, an
 * agent platform) calls from one address, so a per-IP budget throttled all of its
 * evidence writes to the anonymous quota (100/min). Callers holding a valid credential are
 * now tracked by that credential: the OIDC subject, the token label, or the static key's
 * role. Everyone else is tracked by IP, as before. The quotas themselves come from
 * THROTTLE_* (see app.module.ts) and are counted per route, as @nestjs/throttler does.
 */
@Injectable()
export class ErnestThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const access = req.ernestAccess as ResolvedAccess | undefined;
    if (access && access.role !== 'anonymous') {
      return `cred:${access.role}:${access.subject ?? access.label ?? 'static-key'}`;
    }
    return `ip:${req.ip}`;
  }
}

/** Whether the request carries a valid credential (as resolved by AccessResolutionMiddleware). */
export function isAuthenticated(req: any): boolean {
  const access = req?.ernestAccess as ResolvedAccess | undefined;
  return !!access && access.role !== 'anonymous';
}
