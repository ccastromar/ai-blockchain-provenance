const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { ApiKeyGuard } = require('../dist/common/api-key.guard');
const { PlatformAdminGuard } = require('../dist/common/platform-admin.guard');
const { ReadAccessGuard } = require('../dist/common/read-access.guard');
const { functionsForRole, roleForFunctions } = require('../dist/auth/access-role.util');

// Governance functions (contract v1): evidence.write writes evidence, platform.admin operates
// Ernest, and any function reads. The access is already resolved by the middleware.
function contextWithAccess(functions) {
  const request = {
    path: '/api/models',
    method: 'POST',
    headers: {},
    ernestAccess: { role: roleForFunctions(functions), functions },
  };
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

async function allowed(guard, functions) {
  try {
    return await guard.canActivate(contextWithAccess(functions));
  } catch (err) {
    if (err instanceof UnauthorizedException) return false;
    throw err;
  }
}

function withWriteKey(fn) {
  return async () => {
    const previous = process.env.ERNEST_API_KEY;
    process.env.ERNEST_API_KEY = 'configured';
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env.ERNEST_API_KEY;
      else process.env.ERNEST_API_KEY = previous;
    }
  };
}

const write = new ApiKeyGuard({}, { enabled: false });
const admin = new PlatformAdminGuard({}, { enabled: false });
const read = new ReadAccessGuard({}, { enabled: false });

test('evidence.write writes evidence but does not operate Ernest', withWriteKey(async () => {
  assert.equal(await allowed(write, ['evidence.write']), true);
  assert.equal(await allowed(admin, ['evidence.write']), false);
}));

test('platform.admin operates Ernest but does not write evidence', withWriteKey(async () => {
  assert.equal(await allowed(admin, ['platform.admin']), true);
  assert.equal(await allowed(write, ['platform.admin']), false);
}));

test('audit only reads', withWriteKey(async () => {
  assert.equal(await allowed(read, ['audit']), true);
  assert.equal(await allowed(write, ['audit']), false);
  assert.equal(await allowed(admin, ['audit']), false);
}));

test('no function reads nothing', withWriteKey(async () => {
  assert.equal(await allowed(read, []), false);
}));

test('a read-write credential keeps both functions; read-only audits', () => {
  assert.deepEqual(functionsForRole('read-write'), ['evidence.write', 'platform.admin']);
  assert.deepEqual(functionsForRole('read-only'), ['audit']);
  assert.deepEqual(functionsForRole('anonymous'), []);
  assert.equal(roleForFunctions(['platform.admin']), 'read-only');
  assert.equal(roleForFunctions(['evidence.write']), 'read-write');
});
