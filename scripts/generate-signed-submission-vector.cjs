#!/usr/bin/env node
/*
 * Regenerates testdata/signed-submission-golden.json — the cross-language fixture
 * for ADR-001 signed submissions (Ed25519 over DSSE PAE of Ernest-canonical bytes).
 *
 * Pins, byte for byte: the signed-payload construction (block data minus the
 * `signature` field minus SERVER_AUGMENTED fields), the PAE encoding, and a
 * signature from a deterministic test keypair. Consumed by the backend, the Go CLI
 * and the Rust/WASM verifier. Never change existing expected values: blocks signed
 * under the old rules would stop verifying.
 */
const { createHash, createPrivateKey, createPublicKey, sign } = require('crypto');
const { writeFileSync } = require('fs');
const path = require('path');
const { canonicalizeEx } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'json-canonicalize'));

const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];
// Fields the server adds to block data AFTER the client signed. Fixed by ADR-001;
// every verifier must strip exactly these (plus `signature`) before checking.
const SERVER_AUGMENTED_FIELDS = ['executedAt'];
const PAYLOAD_TYPE = 'application/vnd.ernest.provenance+json';

// Deterministic test keypair (NEVER use for real evidence).
const seed = createHash('sha256').update('ernest-signed-submission-golden-seed').digest();
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
const publicRaw = publicDer.subarray(publicDer.length - 32);
const keyId = createHash('sha256').update(publicRaw).digest('hex').slice(0, 16);

function pae(payloadType, body) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${payloadType.length} ${payloadType} ${body.length} `, 'utf8'),
    body,
  ]);
}

function signedBytes(data) {
  const stripped = { ...data };
  delete stripped.signature;
  for (const field of SERVER_AUGMENTED_FIELDS) delete stripped[field];
  return pae(PAYLOAD_TYPE, Buffer.from(canonicalizeEx(stripped, { exclude: EXCLUDED_KEYS }), 'utf8'));
}

function vector(name, comment, data) {
  const bytes = signedBytes(data);
  const signature = sign(null, bytes, privateKey);
  return {
    name,
    comment,
    blockData: {
      ...data,
      signature: {
        alg: 'ed25519',
        keyId,
        publicKey: publicRaw.toString('base64'),
        signedAt: '2026-07-05T10:00:00Z',
        sig: signature.toString('base64'),
      },
    },
    signedCanonical: canonicalizeEx(
      (() => { const s = { ...data }; delete s.signature; for (const f of SERVER_AUGMENTED_FIELDS) delete s[f]; return s; })(),
      { exclude: EXCLUDED_KEYS },
    ),
    paeBase64: bytes.toString('base64'),
    signatureBase64: signature.toString('base64'),
  };
}

const out = {
  $comment:
    'Cross-language golden fixture for ADR-001 signed submissions. Signature = Ed25519 over DSSE PAE("' +
    PAYLOAD_TYPE +
    '", ernest-canonical(blockData minus signature minus serverAugmentedFields)). Consumed by backend/test/signing.util.test.js, cli-ernest golden tests and merkle-wasm golden tests. Test keypair only — never sign real evidence with it.',
  payloadType: PAYLOAD_TYPE,
  serverAugmentedFields: SERVER_AUGMENTED_FIELDS,
  keyId,
  publicKeyBase64: publicRaw.toString('base64'),
  privateKeySeedHex: seed.toString('hex'),
  vectors: [
    vector('model-registration', 'Flat block-data shape for a registration, as stored by the backend.', {
      type: 'model_registration',
      modelId: 'credit-risk-v1',
      modelName: 'Credit Risk',
      version: '1.0.0',
      modelHash: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
      gitCommit: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2',
      params: { solver: 'liblinear', threshold: 0.42 },
      metrics: { roc_auc: 0.86 },
      organizationId: 'ernest-demo',
    }),
    vector('inference-with-server-augmented-field', 'executedAt is present in stored data but excluded from signing (server-added after the client signed).', {
      type: 'inference',
      modelId: 'credit-risk-v1',
      inferenceId: 'inf-42',
      inputHash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
      outputHash: '7791764a90b1cb513f1437384ce2336eac19110ef70fa123f144a66e3f735db1',
      executedAt: '2026-07-05T10:00:01.000Z',
      metadata: { channel: 'loan-workflow', urls: 'https://x.example/a?b=1&c=2' },
    }),
  ],
};

const target = path.join(__dirname, '..', 'testdata', 'signed-submission-golden.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.vectors.length} vectors, keyId ${keyId}`);
