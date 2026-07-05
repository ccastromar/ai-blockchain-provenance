// ADR-001 signing: the backend must reproduce the golden fixture byte for byte —
// same discipline as the hash/Merkle fixtures, because a signature disagreement
// between verifiers is also a consensus fork.
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pae, signedBytes, verifyEnvelope, keyIdOf, SIGNATURE_PAYLOAD_TYPE } = require('../dist/common/signing.util');

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'testdata', 'signed-submission-golden.json'), 'utf8'),
);

test('keyId derivation matches the fixture', () => {
  assert.equal(keyIdOf(fixture.publicKeyBase64), fixture.keyId);
});

for (const vector of fixture.vectors) {
  test(`golden vector "${vector.name}": signed bytes reproduce the PAE`, () => {
    const bytes = signedBytes(vector.blockData);
    assert.equal(bytes.toString('base64'), vector.paeBase64);
    assert.ok(bytes.toString('utf8').startsWith(`DSSEv1 ${SIGNATURE_PAYLOAD_TYPE.length} `));
  });

  test(`golden vector "${vector.name}": embedded envelope verifies`, () => {
    assert.deepEqual(verifyEnvelope(vector.blockData, vector.blockData.signature), { ok: true });
  });

  test(`golden vector "${vector.name}": tampered data fails verification`, () => {
    const tampered = { ...vector.blockData, modelId: 'tampered-model' };
    const result = verifyEnvelope(tampered, vector.blockData.signature);
    assert.deepEqual(result, { ok: false, reason: 'signature_invalid' });
  });
}

test('server-augmented fields are excluded from the signed bytes', () => {
  const vector = fixture.vectors.find(v => v.name.includes('server-augmented'));
  const withoutExecutedAt = { ...vector.blockData };
  delete withoutExecutedAt.executedAt;
  assert.equal(
    signedBytes(vector.blockData).toString('base64'),
    signedBytes(withoutExecutedAt).toString('base64'),
    'executedAt must not affect the signature',
  );
});

test('key id mismatch and unsupported algorithm are rejected before crypto', () => {
  const vector = fixture.vectors[0];
  assert.deepEqual(
    verifyEnvelope(vector.blockData, { ...vector.blockData.signature, keyId: 'deadbeefdeadbeef' }),
    { ok: false, reason: 'key_id_mismatch' },
  );
  assert.deepEqual(
    verifyEnvelope(vector.blockData, { ...vector.blockData.signature, alg: 'rsa' }),
    { ok: false, reason: 'unsupported_algorithm' },
  );
});
