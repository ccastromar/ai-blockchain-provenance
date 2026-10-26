// Ernest's side of its contract with Prudence, with batching turned off (EVIDENCE_BATCHING=off):
// contracts/prudence-evidence/interactions-unbatched.json. Its own file, so its own process and
// environment.
const test = require('node:test');
const { verifyPrudenceContract } = require('./support/prudence-contract');

test('Prudence evidence contract, batching off', (t) =>
  verifyPrudenceContract(t, { file: 'interactions-unbatched.json', batching: 'off' }));
