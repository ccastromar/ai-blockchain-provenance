#!/usr/bin/env node
// Sign an Ernest submission per ADR-001 (Ed25519 over DSSE PAE of the canonical
// payload). Zero dependencies beyond Node >= 18 and the json-canonicalize package
// already present in the backend workspace.
//
// Usage:
//   node sign-submission.mjs <privateKeySeedBase64> payload.json
//
// payload.json must contain the BLOCK-DATA shape (flat modelHash/gitCommit for
// registrations; no executedAt for inferences — the server adds it) with null and
// empty values omitted. The tool prints the submission body ready to POST,
// with the signature envelope attached.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalizeEx } = require('../../backend/node_modules/json-canonicalize');

const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];
const SERVER_AUGMENTED_FIELDS = ['executedAt'];
const PAYLOAD_TYPE = 'application/vnd.ernest.provenance+json';

const [seedB64, payloadPath] = process.argv.slice(2);
if (!seedB64 || !payloadPath) {
  console.error('usage: sign-submission.mjs <privateKeySeedBase64> payload.json');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
const stripped = { ...payload };
delete stripped.signature;
for (const f of SERVER_AUGMENTED_FIELDS) delete stripped[f];

const canonical = canonicalizeEx(stripped, { exclude: EXCLUDED_KEYS });
const body = Buffer.from(canonical, 'utf8');
const pae = Buffer.concat([
  Buffer.from(`DSSEv1 ${PAYLOAD_TYPE.length} ${PAYLOAD_TYPE} ${body.length} `, 'utf8'),
  body,
]);

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedB64, 'base64')]),
  format: 'der',
  type: 'pkcs8',
});
const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
const publicRaw = spki.subarray(spki.length - 32);

const envelope = {
  alg: 'ed25519',
  keyId: createHash('sha256').update(publicRaw).digest('hex').slice(0, 16),
  publicKey: publicRaw.toString('base64'),
  signedAt: new Date().toISOString(),
  sig: sign(null, pae, privateKey).toString('base64'),
};

console.log(JSON.stringify({ ...payload, signature: envelope }, null, 2));
