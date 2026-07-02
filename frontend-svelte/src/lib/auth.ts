import { writable } from 'svelte/store';
import { env } from '$env/dynamic/public';

const SESSION_STORAGE_KEY = 'ernest_api_key';

export type ErnestRole = 'read-write' | 'read-only' | 'anonymous' | 'loading';

export interface AuthState {
  role: ErnestRole;
  openAccess: boolean;
  /** Set when the active key resolved to a named Mongo-backed token (see /api/auth/tokens). */
  label?: string;
}

export const authState = writable<AuthState>({ role: 'loading', openAccess: true });

/**
 * The key attached to every API request. Checked in this order: a key entered at
 * runtime (e.g. by an auditor pasting their own read-only key), then the build-time
 * demo key baked into PUBLIC_ERNEST_API_KEY. Stored in sessionStorage rather than
 * localStorage so a runtime-entered key doesn't outlive the browser tab -- appropriate
 * for a one-off auditor session rather than a standing credential.
 */
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
