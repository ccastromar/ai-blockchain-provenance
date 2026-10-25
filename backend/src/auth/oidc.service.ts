import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { governanceModel } from '../governance/governance-model';
import { roleForFunctions, type ErnestRole } from './access-role.util';

export interface OidcPrincipal {
  role: ErnestRole;
  subject: string;
  label?: string;
  // Governance functions (contract v1) the token grants in Ernest. Nothing authorizes by them
  // yet: they ride along with the role until each guard moves to its function.
  functions: string[];
}

/**
 * OIDC caller identity (ADR-002, Decision A). Validates an `Authorization: Bearer <JWT>`
 * against an enterprise IdP and maps its claims to an Ernest role. This is *request*
 * authentication -- who is calling -- and is deliberately distinct from ADR-001's
 * per-emitter Ed25519 signatures, which are *event* authorship (who signed the payload).
 *
 * Additive by design: it is enabled only when OIDC_ISSUER and OIDC_AUDIENCE are set, and
 * verification stays fully local to this process (JWKS fetch aside), so the static-key
 * and Mongo-token paths keep working for CI, scripts and air-gapped deployments.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  private readonly issuer = process.env.OIDC_ISSUER?.trim();
  private readonly audience = process.env.OIDC_AUDIENCE?.trim();
  private readonly explicitJwksUri = process.env.OIDC_JWKS_URI?.trim();
  // Which groups or roles grant what is the governance model's job (ERNEST_GOVERNANCE_MODEL);
  // OIDC_ROLE_CLAIM / OIDC_ROLE_MAP are no longer read. OIDC_DEFAULT_ROLE=read-only still lets
  // a valid token that the model grants nothing read; the default, anonymous, grants nothing.
  private readonly defaultRole = normalizeRole(process.env.OIDC_DEFAULT_ROLE) ?? 'anonymous';
  // Allowed clock skew when validating exp/nbf/iat (seconds).
  private readonly clockToleranceSec = Number(process.env.OIDC_CLOCK_TOLERANCE_SECONDS ?? 30);

  private jwks?: JWTVerifyGetKey;
  private jwksInit?: Promise<JWTVerifyGetKey>;

  // Loaded (and validated) at start: an invalid governance model stops Ernest.
  private readonly governance = governanceModel();

  get enabled(): boolean {
    return Boolean(this.issuer && this.audience);
  }

  /**
   * Verifies a bearer JWT and returns the mapped principal, or null if OIDC is disabled,
   * no bearer is present, or the token is invalid for any reason. Returning null (rather
   * than throwing) lets the caller fall through to the API-key/token paths -- an invalid
   * token grants nothing on its own.
   */
  async verify(bearer: string | undefined): Promise<OidcPrincipal | null> {
    if (!this.enabled || !bearer) return null;

    try {
      const jwks = await this.getJwks();
      const { payload } = await jwtVerify(bearer, jwks, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockToleranceSec,
      });

      const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!subject) return null;

      // The governance model decides what the token may do; OIDC_DEFAULT_ROLE=read-only still
      // lets any valid token that the model grants nothing read (audit).
      let functions = this.governance.resolve(payload as Record<string, unknown>, 'ernest');
      if (functions.length === 0 && this.defaultRole === 'read-only') functions = ['audit'];
      return {
        role: roleForFunctions(functions),
        subject,
        label: labelFromClaims(payload) ?? subject,
        functions,
      };
    } catch (err) {
      // Debug, not warn: an invalid bearer is an expected, non-fatal condition here
      // (the caller falls back to key-based auth). Real misconfiguration surfaces as a
      // JWKS fetch failure below.
      this.logger.debug(`OIDC token rejected: ${(err as Error).message}`);
      return null;
    }
  }

  private getJwks(): Promise<JWTVerifyGetKey> {
    if (this.jwks) return Promise.resolve(this.jwks);
    if (!this.jwksInit) {
      this.jwksInit = this.resolveJwksUri()
        .then((uri) => {
          this.logger.log(`OIDC enabled (issuer=${this.issuer}); JWKS at ${uri}`);
          this.jwks = createRemoteJWKSet(new URL(uri)); // caches keys and refreshes on unknown kid
          return this.jwks;
        })
        .catch((err) => {
          // Allow a later request to retry discovery instead of caching the failure forever.
          this.jwksInit = undefined;
          this.logger.error(`OIDC JWKS discovery failed: ${(err as Error).message}`);
          throw err;
        });
    }
    return this.jwksInit;
  }

  /** Uses OIDC_JWKS_URI when given, else discovers it from the issuer's OIDC metadata. */
  private async resolveJwksUri(): Promise<string> {
    if (this.explicitJwksUri) return this.explicitJwksUri;
    const configUrl = `${this.issuer!.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(configUrl);
    if (!res.ok) {
      throw new Error(`discovery ${configUrl} returned ${res.status}`);
    }
    const meta = (await res.json()) as { jwks_uri?: string };
    if (!meta.jwks_uri) {
      throw new Error(`discovery document at ${configUrl} has no jwks_uri`);
    }
    return meta.jwks_uri;
  }
}

function normalizeRole(role: string | undefined): ErnestRole | undefined {
  if (role === 'read-write' || role === 'read-only' || role === 'anonymous') return role;
  return undefined;
}

function labelFromClaims(payload: JWTPayload): string | undefined {
  const preferred = payload['preferred_username'];
  if (typeof preferred === 'string' && preferred) return preferred;
  const name = payload['name'];
  if (typeof name === 'string' && name) return name;
  return undefined;
}
