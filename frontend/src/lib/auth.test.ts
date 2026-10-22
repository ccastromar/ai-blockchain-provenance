import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  clearAllCredentials,
  getActiveCredential,
  getActiveKey,
  setActiveKey,
  setBearer
} from './auth.ts';

class MemorySessionStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: new MemorySessionStorage()
});

after(() => {
  if (originalSessionStorage) {
    Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

describe('local credential handling', () => {
  it('clears the bearer and runtime API key from this tab', () => {
    setActiveKey('runtime-key');
    setBearer('oidc-token', Date.now() + 60_000);

    clearAllCredentials();

    assert.equal(getActiveCredential(), null);
    assert.equal(sessionStorage.getItem('ernest_api_key'), null);
    assert.equal(sessionStorage.getItem('ernest_bearer'), null);
    assert.equal(sessionStorage.getItem('ernest_bearer_exp'), null);
  });

  it('allows a new runtime key after local sign-out', () => {
    clearAllCredentials();
    setActiveKey('new-runtime-key');

    assert.equal(getActiveKey(), 'new-runtime-key');
    assert.deepEqual(getActiveCredential(), { kind: 'key', value: 'new-runtime-key' });
  });
});
