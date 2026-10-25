import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { OidcService } from '../auth/oidc.service';
import { bearerFrom, resolveAccess } from '../auth/access-role.util';

const API_KEY_HEADER = 'x-ernest-api-key';
const SAFE_PUBLIC_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function publicReadOnlyEnabled(): boolean {
  return process.env.ERNEST_PUBLIC_READ_ONLY?.trim().toLowerCase() === 'true';
}

// Routes that must stay reachable without a key: /health is polled unauthenticated by
// Docker healthchecks (and /api/health is the same report for the UI behind nginx), and /api/auth/whoami is how a caller with no key yet finds out
// what it's allowed to do.
const EXEMPT_PATHS = new Set(['/health', '/api/health', '/api/auth/whoami']);

// Applied globally (see app.module.ts) so every route is read-gated by default,
// instead of relying on each new controller remembering to opt in. Accepts the
// read-write key, the read-only key, or a live Mongo-backed token of either role --
// write routes additionally require ApiKeyGuard, which only accepts read-write access.
@Injectable()
export class ReadAccessGuard implements CanActivate {
  constructor(
    private readonly tokenService: AccessTokenService,
    private readonly oidcService: OidcService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (EXEMPT_PATHS.has(request.path)) {
      return true;
    }

    // A public evidence portal may expose immutable records to visitors. Keep the exception
    // deliberately narrow: only safe HTTP methods bypass the read credential; every mutation
    // still reaches ApiKeyGuard and requires read-write access.
    if (publicReadOnlyEnabled() && SAFE_PUBLIC_METHODS.has(request.method)) {
      return true;
    }

    const writeKey = process.env.ERNEST_API_KEY;
    const readKey = process.env.ERNEST_READ_API_KEY;
    if (!writeKey && !readKey && !this.oidcService?.enabled) {
      return true;
    }

    const headerValue = request.headers[API_KEY_HEADER];
    const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const bearer = bearerFrom(request.headers.authorization);

    // Already resolved by AccessResolutionMiddleware for this request; resolve here only if
    // the middleware did not run (e.g. a guard used outside the HTTP pipeline).
    const access = request.ernestAccess ?? await resolveAccess(actualKey, this.tokenService, { bearer, oidc: this.oidcService });
    // Any governance function lets its holder read Ernest.
    if (!access.functions?.length) {
      throw new UnauthorizedException('Invalid or missing Ernest credential');
    }

    // Expose the resolved identity for request-level audit binding (ADR-002 A4).
    request.ernestAccess = access;
    return true;
  }
}
