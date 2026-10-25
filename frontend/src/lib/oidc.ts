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
const SILENT_KEY = 'ernest_oidc_silent';
const ID_TOKEN_KEY = 'ernest_oidc_id_token';
const FORCE_LOGIN_KEY = 'ernest_oidc_force_login';
const SILENT_ATTEMPTED_KEY = 'ernest_oidc_silent_attempted';

export const oidcEnabled = Boolean(issuer && clientId);

interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
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
  endpointsCache = {
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    end_session_endpoint: meta.end_session_endpoint,
  };
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
export async function beginLogin(returnTo: string, silent = false): Promise<void> {
  if (!oidcEnabled) throw new Error('OIDC is not configured');
  const { authorization_endpoint } = await endpoints();

  const state = randomString();
  const verifier = randomString(48);
  const codeChallenge = await challengeFrom(verifier);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(RETURN_KEY, returnTo || '/');
  if (silent) sessionStorage.setItem(SILENT_KEY, 'true');
  else sessionStorage.removeItem(SILENT_KEY);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId!,
    redirect_uri: redirectUri(),
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (silent) params.set('prompt', 'none');
  else if (sessionStorage.getItem(FORCE_LOGIN_KEY)) {
    params.set('prompt', 'login');
    sessionStorage.removeItem(FORCE_LOGIN_KEY);
  }
  if (audience) params.set('audience', audience); // Auth0-style; harmless if the IdP ignores it

  window.location.assign(`${authorization_endpoint}?${params.toString()}`);
}

/** Explicit sign-out: no silent re-login, and the next interactive sign-in asks for credentials. */
export function markSignedOut(): void {
  sessionStorage.setItem(FORCE_LOGIN_KEY, 'true');
  sessionStorage.setItem(SILENT_ATTEMPTED_KEY, 'true');
}

/** Ends the IdP session too (RP-initiated logout) so the whole suite signs out. */
export async function endIdpSession(): Promise<void> {
  const idToken = sessionStorage.getItem(ID_TOKEN_KEY) ?? '';
  sessionStorage.removeItem(ID_TOKEN_KEY);
  if (!oidcEnabled) return;
  try {
    const { end_session_endpoint } = await endpoints();
    if (!end_session_endpoint) return;
    const url = new URL(end_session_endpoint);
    url.searchParams.set('client_id', clientId!);
    url.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/`);
    if (idToken) url.searchParams.set('id_token_hint', idToken);
    window.location.assign(url.toString());
  } catch {
    /* local sign-out already done */
  }
}

/** Attempt SSO once per tab without prompting a public visitor to sign in. */
export async function trySilentLogin(returnTo: string): Promise<void> {
  if (!oidcEnabled || sessionStorage.getItem(SILENT_ATTEMPTED_KEY)) return;
  sessionStorage.setItem(SILENT_ATTEMPTED_KEY, 'true');
  await beginLogin(returnTo, true);
}

/**
 * Completes the login on the /auth/callback route: validates state, exchanges the code
 * for tokens, stores the chosen token as the active bearer, and returns where to go next.
 */
export async function completeLogin(): Promise<string> {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const returnTo = sessionStorage.getItem(RETURN_KEY) || '/';
  const silent = sessionStorage.getItem(SILENT_KEY) === 'true';

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  sessionStorage.removeItem(SILENT_KEY);

  if (error) {
    if (!expectedState || state !== expectedState) throw new Error('OIDC state mismatch (possible CSRF)');
    if (silent && ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'].includes(error)) return returnTo;
    throw new Error(url.searchParams.get('error_description') || `IdP returned error: ${error}`);
  }

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
  if (tokens.id_token) sessionStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  setBearer(bearer, expiresAt);
  return returnTo;
}

const CHECK_PREFIX = 'idp-check:';
const RENEW_WINDOW_MS = 120000;

/** Seconds-precision JWT expiry in ms, or 0 when unreadable. */
function jwtExpiryMs(token: string): number {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(part + "===".slice((part.length + 3) % 4))).exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

/** Runs inside the hidden iframe: reports the prompt=none outcome to the parent and stops. */
export function reportIdpSessionIfFramed(): boolean {
  if (window.parent === window) return false;
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "";
  if (!state.startsWith(CHECK_PREFIX)) return false;
  window.parent.postMessage(
    { type: "idp-check", state, active: !params.has("error"), code: params.get("code") },
    window.location.origin,
  );
  return true;
}

type CheckResult = { active: boolean; code: string | null };

function idpCheck(
  authorizationEndpoint: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
): Promise<CheckResult | null> {
  return new Promise((resolve) => {
    const state =
      CHECK_PREFIX +
      Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    const finish = (value: CheckResult | null) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      iframe.remove();
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "idp-check" || event.data.state !== state) return;
      finish({ active: Boolean(event.data.active), code: event.data.code ?? null });
    };
    const timer = setTimeout(() => finish(null), 8000);
    window.addEventListener("message", onMessage);
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope,
      redirect_uri: redirectUri,
      prompt: "none",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    iframe.src = url.toString();
    document.body.appendChild(iframe);
  });
}

interface SessionWatch {
  authorizationEndpoint: () => Promise<string>;
  clientId: string;
  redirectUri: string;
  hasSession: () => boolean;
  /** Current token's expiry in ms (0 = unknown). */
  expiresAt: () => number;
  pkce: () => Promise<{ verifier: string; challenge: string }>;
  exchange: (code: string, verifier: string) => Promise<void>;
  onEnded: () => void;
}

/**
 * While this app holds a session, asks the IdP now and then (and when the tab regains focus)
 * whether the SSO session is alive. A sign-out done in another app of the suite ends ours; a
 * token about to expire is renewed silently from the same check, so users are not bounced.
 */
export function watchIdpSession(w: SessionWatch): () => void {
  let busy = false;
  const check = async () => {
    if (busy || document.hidden || !w.hasSession()) return;
    busy = true;
    try {
      const { verifier, challenge } = await w.pkce();
      const result = await idpCheck(await w.authorizationEndpoint(), w.clientId, w.redirectUri, challenge);
      if (!result || !w.hasSession()) return;
      if (!result.active) w.onEnded();
      else if (result.code && w.expiresAt() - Date.now() < RENEW_WINDOW_MS) await w.exchange(result.code, verifier);
    } catch {
      /* transient: try again later */
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(check, 30000);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("focus", check);
  };
}

async function renewWithCode(code: string, verifier: string) {
  const { token_endpoint } = await endpoints();
  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: clientId!,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return;
  const tokens = (await res.json()) as { access_token?: string; id_token?: string; expires_in?: number };
  if (tokens.id_token) sessionStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  const bearer = audience ? tokens.access_token : tokens.id_token;
  if (bearer) setBearer(bearer, tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined);
}

export const watchErnestSession = (hasSession: () => boolean, onEnded: () => void) =>
  watchIdpSession({
    authorizationEndpoint: async () => (await endpoints()).authorization_endpoint,
    clientId: clientId!,
    redirectUri: redirectUri(),
    hasSession,
    expiresAt: () => jwtExpiryMs(sessionStorage.getItem('ernest_bearer') ?? ''),
    pkce: async () => {
      const verifier = randomString(48);
      return { verifier, challenge: await challengeFrom(verifier) };
    },
    exchange: renewWithCode,
    onEnded,
  });
