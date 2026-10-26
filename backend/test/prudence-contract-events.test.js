// Ernest's side of its contract with Prudence in Ernest's default mode, EVIDENCE_BATCHING=events
// (contracts/prudence-evidence/interactions-events.json): one block per event through the event
// store. Its own file, so its own process and environment.
const test = require('node:test');
const { verifyPrudenceContract } = require('./support/prudence-contract');

test('Prudence evidence contract, batching events (the default)', (t) =>
  verifyPrudenceContract(t, { file: 'interactions-events.json', batching: 'events' }));
