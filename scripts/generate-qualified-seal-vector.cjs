#!/usr/bin/env node
/*
 * Regenerates testdata/qualified-seal-golden.json — the cross-language fixture for
 * ADR-002 B2 qualified electronic seals (ECDSA P-256 over DSSE PAE of Ernest-canonical
 * bytes, carried in a qeseal-ecdsa-p256 envelope with an X.509 chain in x5c).
 *
 * Pins, byte for byte: the signed-payload construction (block data minus `signature`
 * minus SERVER_AUGMENTED fields), the PAE encoding, and the embedded certificate chain.
 * Consumed by the backend, the Go CLI and the Rust/WASM verifier.
 *
 * NOTE: ECDSA signatures are non-deterministic, so re-running updates the `sig` values
 * (still valid). The committed fixture is the source of truth. The certificate chain and
 * keyId are stable. TEST CERTIFICATES ONLY — never seal real evidence with these.
 */
const { createHash, createPrivateKey, sign, X509Certificate } = require('crypto');
const { writeFileSync } = require('fs');
const path = require('path');
const { canonicalizeEx } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'json-canonicalize'));

const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];
const SERVER_AUGMENTED_FIELDS = ['executedAt'];
const PAYLOAD_TYPE = 'application/vnd.ernest.provenance+json';

// --- Fixed TEST certificate chain (EC P-256). Test only; never real evidence. ---
const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBuTCCAV+gAwIBAgIUNiohCLWGYoVD9rY4Dbdnke5Xp1MwCgYIKoZIzj0EAwIw
MjEcMBoGA1UEAwwTRXJuZXN0IFRlc3QgUVRTUCBDQTESMBAGA1UECgwJVGVzdCBR
VFNQMB4XDTI2MTAwMzE1MTUyM1oXDTM2MDkzMDE1MTUyM1owMjEcMBoGA1UEAwwT
RXJuZXN0IFRlc3QgUVRTUCBDQTESMBAGA1UECgwJVGVzdCBRVFNQMFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEuZiI1J8c/D9e7v2m3KMhPC4emFCaavfILAWG4XUg
/xwp0N6+fbPHsI29fnuTjprDF6hdU7C7QQ3VGgJNwjzEeqNTMFEwHQYDVR0OBBYE
FAtqKb8+Z1gbzIyRpwZrFiAeVzV4MB8GA1UdIwQYMBaAFAtqKb8+Z1gbzIyRpwZr
FiAeVzV4MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhANIV9+Cr
T40RHiDRQNr0JlsluCf1GO8OwQPG1W5lD5xYAiApXNjRSezcuT+nGJw1cXmijglY
RPTokASaq0GmlkVC1A==
-----END CERTIFICATE-----`;

const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIBozCCAUmgAwIBAgIUN0mq1vXW2e8kITJtmgL/Lly5w28wCgYIKoZIzj0EAwIw
MjEcMBoGA1UEAwwTRXJuZXN0IFRlc3QgUVRTUCBDQTESMBAGA1UECgwJVGVzdCBR
VFNQMB4XDTI2MTAwMzE1MTUyM1oXDTI3MTAwMzE1MTUyM1owLTEXMBUGA1UEAwwO
QWNtZSBCYW5rIFNlYWwxEjAQBgNVBAoMCUFjbWUgQmFuazBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABBG4JvvR3fYhgJCcnBmNN8/hxEqoYoIaeNRZOAtbgcBzzuBq
VErd7vlqlfnBrySr4JQmq3lmQK0przO9p+xnmR6jQjBAMB0GA1UdDgQWBBQ5vVed
uAqTYAAa37dKjXDVGqdUFzAfBgNVHSMEGDAWgBQLaim/PmdYG8yMkacGaxYgHlc1
eDAKBggqhkjOPQQDAgNIADBFAiEA8udMjCnYPf2vCRcY28h7Cs6PWkgQldxonLTi
hBvK1UECICWtG/0wWwoNvq5HA9qNdV+WXAe8jfbXHr19yCVbVbL+
-----END CERTIFICATE-----`;

// TEST-ONLY key for a fictitious "Acme Bank" seal under a test QTSP CA. Not a real secret.
const LEAF_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFYM4HOt7K+beIr9IEZXRacgmmWULgb0KYBkKGeITZYFoAoGCCqGSM49
AwEHoUQDQgAEEbgm+9Hd9iGAkJycGY03z+HESqhighp41Fk4C1uBwHPO4GpUSt3u
+WqV+cGvJKvglCareWZArSmvM72n7GeZHg==
-----END EC PRIVATE KEY-----`;

const leafKey = createPrivateKey(LEAF_KEY_PEM);
const leafDer = new X509Certificate(LEAF_PEM).raw; // DER bytes
const caDer = new X509Certificate(CA_PEM).raw;
const leafDerB64 = leafDer.toString('base64');
const caDerB64 = caDer.toString('base64');
// keyId for a qualified seal = SHA-256 fingerprint prefix of the leaf certificate.
const keyId = createHash('sha256').update(leafDer).digest('hex').slice(0, 16);

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
  const canonical = canonicalizeEx(
    (() => {
      const s = { ...data };
      delete s.signature;
      for (const f of SERVER_AUGMENTED_FIELDS) delete s[f];
      return s;
    })(),
    { exclude: EXCLUDED_KEYS },
  );
  const bytes = signedBytes(data);
  const signature = sign('sha256', bytes, { key: leafKey, dsaEncoding: 'ieee-p1363' });
  const envelope = {
    alg: 'qeseal-ecdsa-p256',
    keyId,
    x5c: [leafDerB64, caDerB64],
    signedAt: '2026-10-03T12:00:00Z',
    sig: signature.toString('base64'),
  };
  return {
    name,
    comment,
    blockData: { ...data, signature: envelope },
    signedCanonical: canonical,
    paeBase64: bytes.toString('base64'),
    signatureBase64: signature.toString('base64'),
  };
}

const fixture = {
  $comment:
    'Cross-language golden fixture for ADR-002 B2 qualified electronic seals. Signature = ECDSA P-256 (SHA-256, IEEE P-1363) over DSSE PAE("application/vnd.ernest.provenance+json", ernest-canonical(blockData minus signature minus serverAugmentedFields)), verified against the leaf certificate in x5c[0]. keyId = first 16 hex of sha256(leaf cert DER). Consumed by backend, Go CLI and merkle-wasm. TEST CERTIFICATES ONLY.',
  payloadType: PAYLOAD_TYPE,
  serverAugmentedFields: SERVER_AUGMENTED_FIELDS,
  alg: 'qeseal-ecdsa-p256',
  keyId,
  leafCertBase64: leafDerB64,
  caCertBase64: caDerB64,
  vectors: [
    vector('model-registration-sealed', 'Flat registration block data, sealed with a qualified electronic seal.', {
      type: 'model_registration',
      modelId: 'credit-risk-v1',
      modelName: 'Credit Risk',
      version: '1.0.0',
      modelHash: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
      gitCommit: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2',
      organizationId: 'ernest-demo',
    }),
    vector('inference-sealed-with-server-augmented-field', 'executedAt is stored but excluded from the sealed bytes.', {
      type: 'inference',
      modelId: 'credit-risk-v1',
      inferenceId: 'inf-42',
      inputHash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
      outputHash: '7791764a90b1cb513f1437384ce2336eac19110ef70fa123f144a66e3f735db1',
      executedAt: '2026-10-03T12:00:01.000Z',
    }),
  ],
};

const out = path.join(__dirname, '..', 'testdata', 'qualified-seal-golden.json');
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${out}`);
console.log(`keyId=${keyId} vectors=${fixture.vectors.length}`);
