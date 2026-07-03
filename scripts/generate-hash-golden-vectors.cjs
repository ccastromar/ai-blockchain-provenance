#!/usr/bin/env node
/*
 * Regenerates testdata/hash-golden-vectors.json — the cross-language consensus
 * fixture for Ernest's block hash.
 *
 * The reference implementation is the NestJS backend's canonicalization
 * (json-canonicalize's canonicalizeEx, RFC 8785 / JCS, with Ernest's excluded
 * keys). The Go event-writer and the Go CLI must reproduce every expected
 * value byte for byte; their golden tests read the same JSON file.
 *
 * DO NOT rerun this script casually: committing changed expected values is a
 * consensus break — blocks already written under the old rules would stop
 * verifying. Rerun only to ADD vectors, and diff the output to prove existing
 * expectations did not move.
 *
 * Usage: node scripts/generate-hash-golden-vectors.cjs
 */
const { createHash } = require('crypto');
const { writeFileSync } = require('fs');
const path = require('path');
const { canonicalizeEx } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'json-canonicalize'));

const EXCLUDED_KEYS = ['__v', '_id', 'createdAt', 'updatedAt', 'hash'];

// Mirrors BlockchainService.calculateHash (backend) and CalculateHash (Go writer):
// sha256 over "index|timestamp|canonicalData|previousHash".
function blockHash(block) {
  const canonicalData = canonicalizeEx(block.data, { exclude: EXCLUDED_KEYS });
  const blockString = [block.index, String(block.timestamp), canonicalData, block.previousHash].join('|');
  return { canonicalData, hash: createHash('sha256').update(blockString).digest('hex') };
}

const GENESIS_HASH = '0'.repeat(64);

const vectors = [
  {
    name: 'flat-strings',
    comment: 'Baseline: flat object, keys arrive unsorted.',
    block: {
      index: 1, timestamp: 1700000000, previousHash: GENESIS_HASH,
      data: { type: 'model_registration', modelId: 'credit-risk-v1', version: '1.0.0', gitCommit: 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2' },
    },
  },
  {
    name: 'key-sort-case',
    comment: 'Uppercase sorts before lowercase (code unit order, not locale).',
    block: {
      index: 2, timestamp: 1700000001, previousHash: GENESIS_HASH,
      data: { zebra: 1, Alpha: 2, alpha: 3, B: 4, b: 5 },
    },
  },
  {
    name: 'key-sort-utf16',
    comment: 'Keys sorted by UTF-16 code units: an emoji (surrogate pair, first unit 0xD83D) sorts BEFORE U+FFFD, the opposite of UTF-8 byte order.',
    block: {
      index: 3, timestamp: 1700000002, previousHash: GENESIS_HASH,
      data: { '�': 'replacement', '\u{1F600}': 'emoji', 'ñ': 'enye', 'z': 'ascii' },
    },
  },
  {
    name: 'string-escapes',
    comment: 'JSON.stringify escaping: short escapes for control chars, no HTML escaping, U+2028/U+2029 kept literal.',
    block: {
      index: 4, timestamp: 1700000003, previousHash: GENESIS_HASH,
      data: {
        quotesAndBackslash: 'a"b\\c',
        controls: 'tab\there\nnewline\rcr\bbs\fff',
        lowControl: 'x\u0001y\u001fz',
        htmlChars: 'a<b>&c',
        lineSeps: 'u\u2028v\u2029w',
        unicode: 'ñandú 模型 😀',
      },
    },
  },
  {
    name: 'numbers-common',
    comment: 'ES number-to-string: trailing zeros dropped, integer-valued doubles print as integers.',
    block: {
      index: 5, timestamp: 1700000004, previousHash: GENESIS_HASH,
      data: { zero: 0, one: 1, negative: -1, int: 42, tenPointZero: 10.0, half: 0.5, tenth: 0.1, metric: 0.8642, big: 1000, decimal: 123.456 },
    },
  },
  {
    name: 'numbers-extreme',
    comment: 'ES exponent-notation boundaries: >= 1e21 and < 1e-6 switch to exponent form; MAX_SAFE_INTEGER stays exact.',
    block: {
      index: 6, timestamp: 1700000005, previousHash: GENESIS_HASH,
      data: {
        hugeExp: 1e21,
        justBelowHuge: 1e20,
        tinyExp: 1.5e-9,
        boundaryDecimal: 0.000001,
        justBelowBoundary: 5e-7,
        maxSafeInt: 9007199254740991,
        maxDouble: 1.7976931348623157e308,
        negExp: -2.5e-8,
      },
    },
  },
  {
    name: 'booleans-and-null',
    comment: 'Canonicalization preserves nulls, empty strings, empty objects and empty arrays (cleaning is a separate, append-time concern).',
    block: {
      index: 7, timestamp: 1700000006, previousHash: GENESIS_HASH,
      data: { yes: true, no: false, nothing: null, emptyString: '', emptyObject: {}, emptyArray: [] },
    },
  },
  {
    name: 'nested-structures',
    comment: 'Recursive key sorting inside nested objects and arrays of objects; array order preserved.',
    block: {
      index: 8, timestamp: 1700000007, previousHash: GENESIS_HASH,
      data: {
        outer: { zInner: { b: 2, a: 1 }, aInner: [3, 2, 1] },
        list: [{ z: 'last', a: 'first' }, null, 'plain', 7, [{ deep: true }]],
      },
    },
  },
  {
    name: 'excluded-keys-recursive',
    comment: 'hash/_id/__v/createdAt/updatedAt are dropped at EVERY depth, including inside arrays.',
    block: {
      index: 9, timestamp: 1700000008, previousHash: GENESIS_HASH,
      data: {
        hash: 'must-not-appear',
        _id: 'must-not-appear',
        __v: 3,
        createdAt: 'must-not-appear',
        updatedAt: 'must-not-appear',
        keep: {
          hash: 'nested-must-not-appear',
          createdAt: 'nested-must-not-appear',
          value: 1,
        },
        items: [{ hash: 'in-array-must-not-appear', ok: true }],
        modelHash: 'kept-not-in-exclude-list',
      },
    },
  },
  {
    name: 'realistic-inference-block',
    comment: 'Shape of a real Ernest inference block written by the NestJS backend.',
    block: {
      index: 10, timestamp: 1783017849, previousHash: 'd6a55e1e1bc2fd33fa41b138bd47a9584fe3a0ca999445133a45dae04f30312b',
      data: {
        type: 'inference',
        modelId: 'race-test-v1',
        inferenceId: 'race-inf-1',
        inputHash: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
        outputHash: '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
        executedAt: '2026-07-02T18:44:09.000Z',
      },
    },
  },
  {
    name: 'realistic-event-block',
    comment: 'Shape of a Go-event-writer block: provider event with nulls and URLs (ampersands in query strings must not be HTML-escaped).',
    block: {
      index: 11, timestamp: 1783068592, previousHash: 'aaaa000000000000000000000000000000000000000000000000000000000000',
      data: {
        type: 'model_registration',
        source: 'huggingface',
        modelId: 'openai-community/gpt2',
        rawEventHash: '7791764a90b1cb513f1437384ce2336eac19110ef70fa123f144a66e3f735db1',
        metadata: {
          huggingFaceUrl: 'https://huggingface.co/api/models?author=openai&sort=downloads',
          updatedConfig: null,
          updatedRefs: null,
          score: 0.97,
          downloads: 1284391,
        },
      },
    },
  },
];

const out = {
  $comment: 'Cross-language golden vectors for Ernest block hashing. Reference: backend canonicalizeEx (RFC 8785) with excluded keys ' + JSON.stringify(EXCLUDED_KEYS) + '. Block string: index|timestamp|canonicalData|previousHash, hashed with SHA-256 (hex). Consumed by backend/test/hash-golden-vectors.test.js, event-ingestor/internal/hashchain/golden_test.go and cli-ernest/internal/hashcanon/golden_test.go. Regenerate ONLY via scripts/generate-hash-golden-vectors.cjs and never change existing expected values: that is a consensus break.',
  excludedKeys: EXCLUDED_KEYS,
  vectors: vectors.map((v) => {
    const { canonicalData, hash } = blockHash(v.block);
    return { name: v.name, comment: v.comment, block: v.block, expectedCanonicalData: canonicalData, expectedHash: hash };
  }),
};

const target = path.join(__dirname, '..', 'testdata', 'hash-golden-vectors.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.vectors.length} vectors to ${target}`);
for (const v of out.vectors) console.log(`  ${v.name}: ${v.expectedHash}`);
