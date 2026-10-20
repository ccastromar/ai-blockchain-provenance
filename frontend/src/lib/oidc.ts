import { env } from '../env';
import { setBearer } from './auth';

// OIDC Authorization Code + PKCE for the SPA (ADR-002, Decision A — frontend side).
// Opt-in: enabled only when PUBLIC_OIDC_ISSUER and PUBLIC_OIDC_CLIENT_ID are set. When
// disabled, the paste-a-key login path is the only option (air-gap / demo).
//
// Token choice: if PUBLIC_OIDC_AUDIENCE is set, we request that audience and send the
// resulting access_token to Ernest; otherwise we send the id_token (whose `aud` is the
// client id). Either way the backend's OIDC_AUDIENCE must equal what we send.

const issuer = env.PUBLIC_OIDC_ISSUER?.trim();
const clientId = env.PUBLIC_OIDC_CLIENT_ID?.trim();
const scope = env.PUBLIC_OIDC_SCOPE?.trim() || 'openid profile email';
const audience = env.PUBLIC_OIDC_AUDIENCE?.trim();
const explicitAuthEndpoint = env.PUBLIC_OIDC_AUTH_ENDPOINT?.trim();
const explicitTokenEndpoint = env.PUBLIC_OIDC_TOKEN_ENDPOINT?.trim();

const STATE_KEY = 'ernest_oidc_state';
const VERIFIER_KEY = 'ernest_oidc_verifier';
const RETURN_KEY = 'ernest_oidc_return';

export const oidcEnabled = Boolean(issuer && clientId);

interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
}
let endpointsCache: OidcEndpoints | undefined;

async function endpoints(): Promise<OidcEndpoints> {
  if (endpointsCache) return endpointsCache;
  if (explicitAuthEndpoint && explicitTokenEndpoint) {
    endpointsCache = { authorization_endpoint: explicitAuthEndpoint, token_endpoint: explicitTokenEndpoint };
    return endpointsCache;
  }
  const url = `${issuer!.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  const meta = (await res.json()) as OidcEndpoints;
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('OIDC discovery document missing authorization_endpoint/token_endpoint');
  }
  endpointsCache = { authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
  return endpointsCache;
}

function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeFrom(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Redirects the browser to the IdP to begin an Authorization Code + PKCE login. */
export async function beginLogin(returnTo: string): Promise<void> {
  if (!oidcEnabled) throw new Error('OIDC is not configured');
  const { authorization_endpoint } = await endpoints();

  const state = randomString();
  const verifier = randomString(48);
  const codeChallenge = await challengeFrom(verifier);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(RETURN_KEY, returnTo || '/');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId!,
    redirect_uri: redirectUri(),
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (audience) params.set('audience', audience); // Auth0-style; harmless if the IdP ignores it

  window.location.assign(`${authorization_endpoint}?${params.toString()}`);
}

/**
 * Completes the login on the /auth/callback route: validates state, exchanges the code
 * for tokens, stores the chosen token as the active bearer, and returns where to go next.
 */
export async function completeLogin(): Promise<string> {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (error) {
    throw new Error(url.searchParams.get('error_description') || `IdP returned error: ${error}`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const returnTo = sessionStorage.getItem(RETURN_KEY) || '/';

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(RETURN_KEY);

  if (!code || !state) throw new Error('Missing code/state in callback');
  if (!expectedState || state !== expectedState) throw new Error('OIDC state mismatch (possible CSRF)');
  if (!verifier) throw new Error('Missing PKCE verifier (session expired?)');

  const { token_endpoint } = await endpoints();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId!,
    code_verifier: verifier,
  });

  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}) ${detail}`.trim());
  }
  const tokens = (await res.json()) as {
    access_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  // Send the access_token when an audience was requested (aud = the API); otherwise the
  // id_token (aud = client id). Backend OIDC_AUDIENCE must match the chosen token.
  const bearer = audience ? tokens.access_token : tokens.id_token;
  if (!bearer) {
    throw new Error(`IdP did not return the expected token (${audience ? 'access_token' : 'id_token'})`);
  }
  const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  setBearer(bearer, expiresAt);
  return returnTo;
}
