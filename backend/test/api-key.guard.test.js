const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { ApiKeyGuard } = require('../dist/common/api-key.guard');

function contextWithHeader(value) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return {
            headers: {
              'x-ernest-api-key': value,
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

test('ApiKeyGuard allows requests when no keys are configured', () =>
  withEnv({ ERNEST_API_KEY: undefined, ERNEST_READ_API_KEY: undefined }, async () => {
    const guard = new ApiKeyGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextWithHeader(undefined)), true);
  }));

test('ApiKeyGuard accepts a matching X-Ernest-Api-Key header', () =>
  withEnv({ ERNEST_API_KEY: 'secret-key' }, async () => {
    const guard = new ApiKeyGuard(fakeTokenService());
    assert.equal(await guard.canActivate(contextWithHeader('secret-key')), true);
  }));

test('ApiKeyGuard rejects a missing or invalid key when configured', () =>
  withEnv({ ERNEST_API_KEY: 'secret-key' }, async () => {
    const guard = new ApiKeyGuard(fakeTokenService());
    await assert.rejects(() => guard.canActivate(contextWithHeader('wrong-key')), UnauthorizedException);
    await assert.rejects(() => guard.canActivate(contextWithHeader(undefined)), UnauthorizedException);
  }));

test('ApiKeyGuard rejects a read-only Mongo token', () =>
  withEnv({ ERNEST_API_KEY: 'secret-key' }, async () => {
    const guard = new ApiKeyGuard(fakeTokenService({ role: 'read-only', label: 'Auditor' }));
    await assert.rejects(() => guard.canActivate(contextWithHeader('ernest_ro_something')), UnauthorizedException);
  }));

test('ApiKeyGuard accepts a read-write Mongo token', () =>
  withEnv({ ERNEST_API_KEY: 'secret-key' }, async () => {
    const guard = new ApiKeyGuard(fakeTokenService({ role: 'read-write', label: 'ML team' }));
    assert.equal(await guard.canActivate(contextWithHeader('ernest_rw_something')), true);
  }));
