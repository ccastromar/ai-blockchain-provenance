import { useSyncExternalStore } from 'react';
import { env } from '../env';

const SESSION_STORAGE_KEY = 'ernest_api_key';
const BEARER_KEY = 'ernest_bearer';
const BEARER_EXP_KEY = 'ernest_bearer_exp';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous' | 'loading';

export interface AuthState {
  role: ErnestRole;
  openAccess: boolean;
  /** Set when the active key resolved to a named Mongo-backed token (see /api/auth/tokens). */
  label?: string;
  /** OIDC subject (IdP `sub`) when signed in via SSO. */
  subject?: string;
}

// Who the active credential is, as Ernest resolves it (/api/auth/whoami). A tiny store so
// non-React code (the API client) can update it and every component re-renders.
let current: AuthState = { role: 'loading', openAccess: true };
const listeners = new Set<() => void>();

export const authState = {
  get: (): AuthState => current,
  set(next: AuthState) {
    current = next;
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authState.subscribe, authState.get);
}

export type CredentialKind = 'bearer' | 'key';
export interface ActiveCredential {
  kind: CredentialKind;
  value: string;
}

/**
 * The credential attached to every API request. An OIDC bearer (SSO) takes precedence
 * over a pasted API key when present and unexpired; otherwise the runtime key (an auditor
 * pasting their own key) and finally the build-time demo key baked into
 * PUBLIC_ERNEST_API_KEY. Stored in sessionStorage rather than localStorage so a
 * runtime-entered credential doesn't outlive the browser tab.
 */
export function getActiveCredential(): ActiveCredential | null {
  const bearer = getActiveBearer();
  if (bearer) return { kind: 'bearer', value: bearer };
  const key = getActiveKey();
  if (key) return { kind: 'key', value: key };
  return null;
}

/** Back-compat: the API key only (used where a key specifically is expected). */
export function getActiveKey(): string {
  if (typeof sessionStorage !== 'undefined') {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) return stored;
  }
  return env.PUBLIC_ERNEST_API_KEY ?? '';
}

export function setActiveKey(key: string) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, key);
  }
}

export function clearActiveKey() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

/** Returns the stored OIDC bearer if present and not past its expiry, else clears it. */
export function getActiveBearer(): string {
  if (typeof sessionStorage === 'undefined') return '';
  const token = sessionStorage.getItem(BEARER_KEY);
  if (!token) return '';
  const exp = sessionStorage.getItem(BEARER_EXP_KEY);
  if (exp && Number(exp) <= Date.now()) {
    clearBearer();
    return '';
  }
  return token;
}

export function setBearer(token: string, expiresAt?: number) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(BEARER_KEY, token);
  if (expiresAt) sessionStorage.setItem(BEARER_EXP_KEY, String(expiresAt));
  else sessionStorage.removeItem(BEARER_EXP_KEY);
}

export function clearBearer() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(BEARER_KEY);
  sessionStorage.removeItem(BEARER_EXP_KEY);
}

/** Clears every stored credential (SSO bearer and pasted key). */
export function clearAllCredentials() {
  clearBearer();
  clearActiveKey();
}
