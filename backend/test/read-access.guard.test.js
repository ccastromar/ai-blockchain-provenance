const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { ReadAccessGuard } = require('../dist/common/read-access.guard');

function contextFor(path, headerValue) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return {
            path,
            headers: {
              'x-ernest-api-key': headerValue,
            },
          };
        },
      };
    },
  };
}

function fakeTokenService(resolveResult = null) {
  return { resolve: async () => resolveResult };
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

test('ReadAccessGuard allows everything when no keys are configured', () =>
  withEnv({ ERNEST_API_KEY: undefined, ERNEST_READ_API_KEY: undefined }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextFor('/api/models', undefined)), true);
  }));

test('ReadAccessGuard accepts the read-write key on a read route', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextFor('/api/models', 'write-secret')), true);
  }));

test('ReadAccessGuard accepts the read-only key on a read route', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextFor('/api/models', 'read-secret')), true);
  }));

test('ReadAccessGuard rejects a missing or wrong key when keys are configured', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: 'read-secret' }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    await assert.rejects(() => guard.canActivate(contextFor('/api/models', 'nope')), UnauthorizedException);
    await assert.rejects(() => guard.canActivate(contextFor('/api/models', undefined)), UnauthorizedException);
  }));

test('ReadAccessGuard exempts /health even when keys are configured', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: undefined }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextFor('/health', undefined)), true);
  }));

test('ReadAccessGuard exempts /api/auth/whoami even when keys are configured', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: undefined }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextFor('/api/auth/whoami', undefined)), true);
  }));

test('ReadAccessGuard accepts a live Mongo-backed token of either role', () =>
  withEnv({ ERNEST_API_KEY: 'write-secret', ERNEST_READ_API_KEY: undefined }, async () => {
    const guard = new ReadAccessGuard(fakeTokenService({ role: 'read-only', label: 'Auditor' }));
    assert.equal(await guard.canActivate(contextFor('/api/models', 'ernest_ro_something')), true);
  }));
