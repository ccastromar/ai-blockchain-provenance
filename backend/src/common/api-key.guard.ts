import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { OidcService } from '../auth/oidc.service';
import { bearerFrom, resolveAccess } from '../auth/access-role.util';

const API_KEY_HEADER = 'x-ernest-api-key';

// Gates write routes (POST/PATCH). Only read-write access satisfies this guard -- a
// caller authenticated with the read-only key, a read-only Mongo token, or an OIDC token
// mapped to read-only (see ReadAccessGuard) must not be able to write.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly tokenService: AccessTokenService,
    private readonly oidcService: OidcService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const writeKey = process.env.ERNEST_API_KEY;
    const readKey = process.env.ERNEST_READ_API_KEY;
    // Fully open only when nothing is configured to authenticate against.
    if (!writeKey && !readKey && !this.oidcService?.enabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headerValue = request.headers[API_KEY_HEADER];
    const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const bearer = bearerFrom(request.headers.authorization);

    const access = await resolveAccess(actualKey, this.tokenService, { bearer, oidc: this.oidcService });
    if (access.role !== 'read-write') {
      throw new UnauthorizedException('Invalid or missing Ernest write credential');
    }

    // Expose the resolved identity for request-level audit binding (ADR-002 A4).
    request.ernestAccess = access;
    return true;
  }
}
