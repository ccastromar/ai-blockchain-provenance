// Ernest's side of its contract with Prudence, with batching on, as the suite deploys it
// (contracts/prudence-evidence/interactions.json). The runner is in support/prudence-contract.js;
// prudence-contract-unbatched.test.js runs the same contract with batching off.
const test = require('node:test');
const { verifyPrudenceContract } = require('./support/prudence-contract');

test('Prudence evidence contract, batching on', (t) =>
  verifyPrudenceContract(t, { file: 'interactions.json', batching: 'on' }));
