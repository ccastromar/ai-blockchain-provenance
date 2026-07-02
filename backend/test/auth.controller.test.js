const assert = require('node:assert/strict');
const test = require('node:test');
const { AuthController } = require('../dist/auth/auth.controller');

function requestWithHeader(value) {
  return { headers: { 'x-ernest-api-key': value } };
}

function fakeTokenService(overrides = {}) {
  return {
    resolve: async () => null,
    create: async (label, role, expiresAt) => ({ id: 'tok1', token: 'ernest_xx_raw', label, role, expiresAt: expiresAt ?? null }),
    list: async () => [],
    revoke: async () => true,
    ...overrides,
  };
}

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('whoami reports read-write with openAccess when no keys are configured', () =>
  withEnv({ ERNEST_API_KEY: undefined, ERNEST_READ_API_KEY: undefined }, async () => {
    const controller = new AuthController(fakeTokenService());
    assert.deepEqual(await controller.whoami(requestWithHeader(undefined)), { role: 'read-write', openAccess: true });
  }));

test('whoami reports read-write for the write key', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const controller = new AuthController(fakeTokenService());
    assert.deepEqual(await controller.whoami(requestWithHeader('write-secret')), { role: 'read-write', openAccess: false });
  }));

test('whoami reports read-only for the read key', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const controller = new AuthController(fakeTokenService());
    assert.deepEqual(await controller.whoami(requestWithHeader('read-secret')), { role: 'read-only', openAccess: false });
  }));

test('whoami reports anonymous for a missing or wrong key', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const controller = new AuthController(fakeTokenService());
    assert.deepEqual(await controller.whoami(requestWithHeader('nope')), { role: 'anonymous', openAccess: false });
    assert.deepEqual(await controller.whoami(requestWithHeader(undefined)), { role: 'anonymous', openAccess: false });
  }));

test('whoami reports the role and label for a live Mongo-backed token', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: undefined }, async () => {
    const controller = new AuthController(fakeTokenService({ resolve: async () => ({ role: 'read-only', label: 'Auditor - Acme' }) }));
    assert.deepEqual(await controller.whoami(requestWithHeader('ernest_ro_something')), {
      role: 'read-only',
      openAccess: false,
      label: 'Auditor - Acme',
    });
  }));

test('createToken forwards label/role and an expiry computed from expiresInDays', () =>
  withEnv({}, async () => {
    let captured;
    const controller = new AuthController(
      fakeTokenService({
        create: async (label, role, expiresAt) => {
          captured = { label, role, expiresAt };
          return { id: 'tok1', token: 'ernest_ro_raw', label, role, expiresAt };
        },
      }),
    );
    const before = Date.now();
    const result = await controller.createToken({ label: 'Auditor - Acme', role: 'read-only', expiresInDays: 1 });
    assert.equal(result.token, 'ernest_ro_raw');
    assert.equal(captured.label, 'Auditor - Acme');
    assert.equal(captured.role, 'read-only');
    assert.ok(captured.expiresAt instanceof Date);
    assert.ok(captured.expiresAt.getTime() >= before + 24 * 60 * 60 * 1000 - 1000);
  }));

test('createToken omits expiry when expiresInDays is not provided', () =>
  withEnv({}, async () => {
    let captured;
    const controller = new AuthController(
      fakeTokenService({
        create: async (label, role, expiresAt) => {
          captured = { label, role, expiresAt };
          return { id: 'tok1', token: 'ernest_rw_raw', label, role, expiresAt };
        },
      }),
    );
    await controller.createToken({ label: 'ML team', role: 'read-write' });
    assert.equal(captured.expiresAt, undefined);
  }));

test('listTokens returns the service list result', () =>
  withEnv({}, async () => {
    const tokens = [{ id: 'tok1', label: 'Auditor', role: 'read-only' }];
    const controller = new AuthController(fakeTokenService({ list: async () => tokens }));
    assert.deepEqual(await controller.listTokens(), tokens);
  }));

test('revokeToken returns { revoked: true } when the service revokes successfully', () =>
  withEnv({}, async () => {
    const controller = new AuthController(fakeTokenService({ revoke: async () => true }));
    assert.deepEqual(await controller.revokeToken('tok1'), { revoked: true });
  }));

test('revokeToken throws NotFoundException when nothing was revoked', () =>
  withEnv({}, async () => {
    const controller = new AuthController(fakeTokenService({ revoke: async () => false }));
    await assert.rejects(() => controller.revokeToken('missing'), /not found/i);
  }));
