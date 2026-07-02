import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { resolveAccess } from '../auth/access-role.util';

const API_KEY_HEADER = 'x-ernest-api-key';

// Routes that must stay reachable without a key: /health is polled unauthenticated by
// Docker healthchecks, and /api/auth/whoami is how a caller with no key yet finds out
// what it's allowed to do.
const EXEMPT_PATHS = new Set(['/health', '/api/auth/whoami']);

// Applied globally (see app.module.ts) so every route is read-gated by default,
// instead of relying on each new controller remembering to opt in. Accepts the
// read-write key, the read-only key, or a live Mongo-backed token of either role --
// write routes additionally require ApiKeyGuard, which only accepts read-write access.
@Injectable()
export class ReadAccessGuard implements CanActivate {
  constructor(private readonly tokenService: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (EXEMPT_PATHS.has(request.path)) {
      return true;
    }

    const writeKey = process.env.ERNEST_API_KEY;
    const readKey = process.env.ERNEST_READ_API_KEY;
    if (!writeKey && !readKey) {
      return true;
    }

    const headerValue = request.headers[API_KEY_HEADER];
    const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const { role } = await resolveAccess(actualKey, this.tokenService);
    if (role === 'anonymous') {
      throw new UnauthorizedException('Invalid or missing Ernest API key');
    }

    return true;
  }
}
