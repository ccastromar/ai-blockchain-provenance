import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { OidcService } from '../auth/oidc.service';
import { bearerFrom, resolveAccess } from '../auth/access-role.util';

const API_KEY_HEADER = 'x-ernest-api-key';

// Gates evidence writes (models, inferences, simulations): the caller needs the evidence.write
// governance function (contract v1). A read-write key or token has it; a read-only one, or an
// OIDC token whose groups grant only audit or platform.admin, does not.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  protected readonly requiredFunction: string = 'evidence.write';
  protected readonly refusal: string = 'Invalid or missing Ernest write credential';

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

    // Already resolved by AccessResolutionMiddleware for this request; resolve here only if
    // the middleware did not run (e.g. a guard used outside the HTTP pipeline).
    const access = request.ernestAccess ?? await resolveAccess(actualKey, this.tokenService, { bearer, oidc: this.oidcService });
    if (!access.functions?.includes(this.requiredFunction)) {
      throw new UnauthorizedException(this.refusal);
    }

    // Expose the resolved identity for request-level audit binding (ADR-002 A4).
    request.ernestAccess = access;
    return true;
  }
}
