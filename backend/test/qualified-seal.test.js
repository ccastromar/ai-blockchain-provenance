// ADR-002 B2 qualified electronic seals: the backend must reproduce the cross-language
// golden fixture byte for byte and verify the embedded seal against its leaf certificate,
// in lockstep with the Go CLI and the Rust/WASM verifier. A disagreement here is a
// consensus fork, exactly as for the ADR-001 Ed25519 fixture.
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { signedBytes, verifyEnvelope, keyIdOfCert, validateSealTrustChain, SIGNATURE_PAYLOAD_TYPE } = require('../dist/common/signing.util');

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'testdata', 'qualified-seal-golden.json'), 'utf8'),
);

test('keyId derivation matches the leaf certificate', () => {
  assert.equal(keyIdOfCert(fixture.leafCertBase64), fixture.keyId);
});

for (const vector of fixture.vectors) {
  test(`qseal golden "${vector.name}": sealed bytes reproduce the PAE`, () => {
    const bytes = signedBytes(vector.blockData);
    assert.equal(bytes.toString('base64'), vector.paeBase64);
    assert.ok(bytes.toString('utf8').startsWith(`DSSEv1 ${SIGNATURE_PAYLOAD_TYPE.length} `));
  });

  test(`qseal golden "${vector.name}": embedded seal verifies`, () => {
    assert.deepEqual(verifyEnvelope(vector.blockData, vector.blockData.signature), { ok: true });
  });

  test(`qseal golden "${vector.name}": tampered data fails verification`, () => {
    const tampered = { ...vector.blockData, modelId: 'tampered-model' };
    assert.deepEqual(verifyEnvelope(tampered, vector.blockData.signature), { ok: false, reason: 'signature_invalid' });
  });
}

test('qseal server-augmented fields are excluded from the sealed bytes', () => {
  const vector = fixture.vectors.find((v) => v.name.includes('server-augmented'));
  const withoutExecutedAt = { ...vector.blockData };
  delete withoutExecutedAt.executedAt;
  assert.equal(
    signedBytes(vector.blockData).toString('base64'),
    signedBytes(withoutExecutedAt).toString('base64'),
    'executedAt must not affect the seal',
  );
});

test('qseal keyId mismatch is rejected before crypto', () => {
  const vector = fixture.vectors[0];
  assert.deepEqual(
    verifyEnvelope(vector.blockData, { ...vector.blockData.signature, keyId: 'deadbeefdeadbeef' }),
    { ok: false, reason: 'key_id_mismatch' },
  );
});

test('trust-chain validation is unconfigured by default (LOTL boundary)', () => {
  // Without QSEAL_TRUSTED_CA_PEM the crypto still verifies, but the seal is not yet
  // "qualified" -- the trust anchor must come from the EU Trusted List.
  delete process.env.QSEAL_TRUSTED_CA_PEM;
  const result = validateSealTrustChain(fixture.vectors[0].blockData.signature.x5c);
  assert.deepEqual(result, { trusted: false, reason: 'trust_list_not_configured' });
});
