// Ernest fails closed in production: no credentials, no start (src/common/production-security.ts).
const assert = require('node:assert/strict');
const test = require('node:test');
const { assertProductionSecurity } = require('../dist/common/production-security');

const SECURED = {
  NODE_ENV: 'production',
  ERNEST_API_KEY: 'write-key',
  ERNEST_READ_API_KEY: 'read-key',
  OIDC_ISSUER: 'https://sso.example.org/realms/x',
  OIDC_AUDIENCE: 'ernest',
};

test('production with both keys and OIDC starts', () => {
  assert.doesNotThrow(() => assertProductionSecurity({ ...SECURED }));
});

test('production refuses each missing credential by name', () => {
  for (const name of ['ERNEST_API_KEY', 'ERNEST_READ_API_KEY', 'OIDC_ISSUER', 'OIDC_AUDIENCE']) {
    const env = { ...SECURED, [name]: '  ' };
    assert.throws(() => assertProductionSecurity(env), new RegExp(`without .*${name}`), name);
  }
  assert.throws(() => assertProductionSecurity({ NODE_ENV: 'production' }), /accept evidence from anyone/);
});

test('production refuses a read key that is the write key', () => {
  assert.throws(
    () => assertProductionSecurity({ ...SECURED, ERNEST_READ_API_KEY: SECURED.ERNEST_API_KEY }),
    /must differ/);
});

test('ERNEST_OPEN_ACCESS=true is the explicit way out, and it is logged', () => {
  const warnings = [];
  assert.doesNotThrow(() =>
    assertProductionSecurity({ NODE_ENV: 'production', ERNEST_OPEN_ACCESS: 'true' }, (m) => warnings.push(m)));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /without requiring credentials/);
  assert.throws(() => assertProductionSecurity({ NODE_ENV: 'production', ERNEST_OPEN_ACCESS: 'yes' }));
});

test('outside production nothing is required', () => {
  assert.doesNotThrow(() => assertProductionSecurity({}));
  assert.doesNotThrow(() => assertProductionSecurity({ NODE_ENV: 'development' }));
});
