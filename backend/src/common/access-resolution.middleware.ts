import { Injectable, NestMiddleware } from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { OidcService } from '../auth/oidc.service';
import { bearerFrom, resolveAccess, ResolvedAccess } from '../auth/access-role.util';

const API_KEY_HEADER = 'x-ernest-api-key';

/**
 * Resolves who is calling once, before any guard runs, and stores it on the request
 * (`request.ernestAccess`). Never rejects: authorization stays with ReadAccessGuard and
 * ApiKeyGuard. It exists so the rate limiter can count per caller identity — a valid
 * credential gets its own quota, while anonymous or invalid callers (including someone
 * guessing keys) are still limited per IP, before any authentication work is spent on them.
 */
@Injectable()
export class AccessResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenService: AccessTokenService,
    private readonly oidcService: OidcService,
  ) {}

  async use(req: any, _res: any, next: () => void) {
    try {
      const headerValue = req.headers[API_KEY_HEADER];
      const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      const bearer = bearerFrom(req.headers.authorization);
      req.ernestAccess = await resolveAccess(actualKey, this.tokenService, { bearer, oidc: this.oidcService });
    } catch {
      req.ernestAccess = { role: 'anonymous' } as ResolvedAccess;
    }
    next();
  }
}

/** True when Ernest has no credential configured at all (open dev mode). */
export function openAccessMode(oidcEnabled: boolean): boolean {
  return !process.env.ERNEST_API_KEY && !process.env.ERNEST_READ_API_KEY && !oidcEnabled;
}
