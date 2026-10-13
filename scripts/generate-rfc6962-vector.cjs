#!/usr/bin/env node
/*
 * Regenerates testdata/rfc6962-golden.json — the cross-language fixture for ADR-004
 * evidence batches (RFC 6962 / RFC 9162 Merkle trees over SHA-256).
 *
 * The reference implementation is the backend's backend/src/blockchain/merkle-rfc6962.ts
 * (build the backend first: the compiled module is loaded from backend/dist). The Go CLI
 * (`ernest proof verify`, `ernest hashchain verify`) and merkle-wasm must reproduce every
 * leaf hash, root and audit path here and reject the tampered variants. The `ct` case is
 * the Certificate Transparency reference tree: its roots are the published RFC 6962 test
 * values, so this fixture also pins the backend itself to the standard. As with the other
 * vectors: never change existing expected values — issued event proofs would stop verifying.
 *
 * Usage: (cd backend && npx nest build) && node scripts/generate-rfc6962-vector.cjs
 */
const { createHash } = require('crypto');
const { writeFileSync, existsSync } = require('fs');
const path = require('path');

const modulePath = path.join(__dirname, '..', 'backend', 'dist', 'blockchain', 'merkle-rfc6962.js');
if (!existsSync(modulePath)) {
  console.error(`Missing ${modulePath}: build the backend first (cd backend && npx nest build).`);
  process.exit(1);
}
const { merkleRoot, auditPath, leafHashOf, canonicalEventData, verifyInclusion } = require(modulePath);

// Published CT test tree (certificate-transparency merkle_tree_test): leaf inputs and
// the expected root for every prefix size 1..8.
const CT_INPUTS = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'];
const CT_ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

const rawLeafHash = (hex) => createHash('sha256').update(Buffer.concat([Buffer.from([0]), Buffer.from(hex, 'hex')])).digest('hex');

function treeCase(leafHashes) {
  const root = merkleRoot(leafHashes);
  const proofs = leafHashes.map((leaf, i) => {
    const p = auditPath(leafHashes, i);
    if (!verifyInclusion(leaf, i, leafHashes.length, p, root)) throw new Error(`self-check failed at leaf ${i}`);
    return { leafIndex: i, leafHash: leaf, auditPath: p };
  });
  return { treeSize: leafHashes.length, root, proofs };
}

const ctLeaves = CT_INPUTS.map(rawLeafHash);
const ctTrees = CT_ROOTS.map((expected, n) => {
  const t = treeCase(ctLeaves.slice(0, n + 1));
  if (t.root !== expected) throw new Error(`backend disagrees with the CT reference root for size ${n + 1}`);
  return t;
});

// Event data exactly as Ernest stores it (cleaned, then JCS-canonicalized for the leaf):
// nested objects, floats, unicode and a signature envelope exercise the canonicalizer.
const EVENTS = [
  { type: 'model_registration', modelId: 'org/credit-risk', modelName: 'Credit Risk', version: '1.0.0', modelHash: 'f1345cf835020a390c54aba0bd5173e42d34d414b6161ec75e30577280215912', gitCommit: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2', params: { threshold: 0.42, solver: 'liblinear' }, metrics: { roc_auc: 0.86 } },
  { type: 'inference', modelId: 'org/credit-risk', inferenceId: 'inf-001', inputHash: '7b2f1e0d9a6c4b3f2e1d0c9b8a7f6e5d4c3b2a1908172635445362718090a1b2', outputHash: '1f0e2d3c4b5a6978879695a4b3c2d1e0f1029384756aabbccddeeff001122334', params: { return_probs: true, top_k: 3 }, metadata: { stage: 'execution', aiSystemId: 'sys-1', note: 'préstamo ✓' }, executedAt: '2026-10-13T10:00:00.000Z' },
  { type: 'inference', modelId: 'org/credit-risk', inferenceId: 'inf-002', inputHash: '9c8b7a69584736251403f2e1d0c9b8a7f6e5d4c3b2a190817263544536271809', outputHash: '2a3b4c5d6e7f8091a2b3c4d5e6f7081928374655aabbccddeeff001122334455', params: { temperature: 1e-7, big: 12345678901 }, executedAt: '2026-10-13T10:00:01.000Z', signature: { alg: 'ed25519', keyId: 'emitter-a', publicKey: 'MCowBQYDK2VwAyEA', sig: 'c2lnbmF0dXJl', signedAt: '2026-10-13T10:00:00Z' } },
  { type: 'inference', modelId: 'org/other', inferenceId: 'inf-003', inputHash: '00', outputHash: '01', metadata: { tags: ['a', 'b', { z: 1, a: 2 }] }, executedAt: '2026-10-13T10:00:02.000Z' },
  { type: 'inference', modelId: 'org/other', inferenceId: 'inf-004', inputHash: '02', outputHash: '03', executedAt: '2026-10-13T10:00:03.000Z' },
];

const events = EVENTS.map((data) => ({ data, canonical: canonicalEventData(data), leafHash: leafHashOf(data) }));
const batch = treeCase(events.map((e) => e.leafHash));

const tamperedData = { ...EVENTS[1], outputHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' };

const out = {
  $comment:
    'Cross-language golden fixture for ADR-004 evidence batches. Leaf = SHA-256(0x00 || JCS(data)) with the same excluded keys as the block hash; node = SHA-256(0x01 || left || right); split at the largest power of two below n; no pair sorting (RFC 6962 / RFC 9162). Audit paths are bottom-up; verification is RFC 9162 §2.1.3.2. Generated by scripts/generate-rfc6962-vector.cjs from backend/src/blockchain/merkle-rfc6962.ts; consumed by the Go CLI and merkle-wasm. Never change existing expected values: issued event proofs would stop verifying.',
  treeAlg: 'rfc6962-sha256',
  ct: {
    comment: 'Certificate Transparency reference tree: leafInputs are raw hex leaf bytes (leaf hash = SHA-256(0x00 || bytes)); trees[n-1] is the prefix of size n, roots equal the published RFC 6962 test values.',
    leafInputs: CT_INPUTS,
    trees: ctTrees,
  },
  events: {
    comment: 'Ernest event data → canonical JCS bytes → leaf hash, and the batch tree over all of them in order.',
    items: events,
    batch,
  },
  tampered: {
    comment: 'events.items[1] with a modified outputHash: its leaf hash must differ, and with events.batch.proofs[1].auditPath it must NOT reach events.batch.root.',
    data: tamperedData,
    leafIndex: 1,
  },
};

if (verifyInclusion(leafHashOf(tamperedData), 1, batch.treeSize, batch.proofs[1].auditPath, batch.root)) {
  throw new Error('tampered case unexpectedly verifies');
}

const target = path.join(__dirname, '..', 'testdata', 'rfc6962-golden.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${target}`);
