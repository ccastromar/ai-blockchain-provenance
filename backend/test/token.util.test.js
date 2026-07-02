const assert = require('node:assert/strict');
const test = require('node:test');
const { generateToken, hashToken } = require('../dist/auth/token.util');

test('generateToken prefixes the raw token by role', () => {
  assert.match(generateToken('read-write').token, /^ernest_rw_/);
  assert.match(generateToken('read-only').token, /^ernest_ro_/);
});

test('generateToken never returns the same raw token twice', () => {
  const a = generateToken('read-only');
  const b = generateToken('read-only');
  assert.notEqual(a.token, b.token);
});

test('generateToken returns the sha256 hash of the raw token, not the token itself', () => {
  const { token, tokenHash } = generateToken('read-write');
  assert.equal(tokenHash, hashToken(token));
  assert.notEqual(tokenHash, token);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
});

test('hashToken is deterministic', () => {
  assert.equal(hashToken('same-input'), hashToken('same-input'));
  assert.notEqual(hashToken('input-a'), hashToken('input-b'));
});
