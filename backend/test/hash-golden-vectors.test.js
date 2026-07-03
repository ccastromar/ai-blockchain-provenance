// Cross-language consensus suite: the backend must reproduce every golden vector in
// testdata/hash-golden-vectors.json byte for byte. The same file is asserted against the
// Go event-writer (event-ingestor/internal/hashchain/golden_test.go) and the Go CLI, so
// a change that breaks any of the three implementations -- including a behavior change
// in the json-canonicalize dependency after an upgrade -- fails CI instead of silently
// forking the chain between writers.
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { canonicalizeEx } = require('json-canonicalize');
const { BlockchainService } = require('../dist/blockchain/blockchain.service');

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'testdata', 'hash-golden-vectors.json'), 'utf8'),
);

// calculateHash never touches the injected models, so a bare instance is enough to run
// the exact production code path.
const service = new BlockchainService(null, null);

for (const vector of fixture.vectors) {
  test(`golden vector "${vector.name}": canonical data matches`, () => {
    const canonical = canonicalizeEx(vector.block.data, { exclude: fixture.excludedKeys });
    assert.equal(canonical, vector.expectedCanonicalData);
  });

  test(`golden vector "${vector.name}": production calculateHash matches`, () => {
    const hash = service['calculateHash'](vector.block);
    assert.equal(hash, vector.expectedHash);
  });
}

test('negative zero canonicalizes to 0 (not representable in the JSON fixture)', () => {
  assert.equal(canonicalizeEx({ a: -0 }, { exclude: fixture.excludedKeys }), '{"a":0}');
});
