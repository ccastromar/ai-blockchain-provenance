# Contributing to Ernest

Thank you for helping. Ernest is the evidence vertex of the Chestertown suite (AOS
orchestrates, Ernest proves, Prudence governs). What it records must stay verifiable by anyone,
offline, so hashes, proofs and the contracts below matter as much as the code.

## Before you open a pull request

Run what CI runs for the parts you changed:

```bash
pnpm install --frozen-lockfile
pnpm --filter ernest-backend test:integrity   # needs MongoDB on 127.0.0.1:27017
cd frontend && npm ci && npm test && npm run build && npm run test:e2e
pnpm --filter blockchain compile
(cd cli-ernest && go test ./...)               # its Mongo integration test uses Docker, skipped without it
(cd merkle-wasm && cargo test)
(cd event-ingestor && go test ./...)
```

The console's browser tests also check WCAG 2.1 AA with axe, in light and dark themes. The
golden vectors in `testdata/` pin hashes, signatures and RFC 6962 proofs across the backend, Go
and Rust: a change that moves one is a format change, not a refactor.

## Contracts with the other apps

| Directory | What it is | Owner |
| --- | --- | --- |
| `backend/test/contracts/prudence-evidence/` | What Prudence sends to Ernest and reads back | Prudence (synced copy) |
| `event-ingestor/internal/kafkasource/testdata/aos-audit-events/` | The Kafka records AOS publishes | AOS (synced copy) |
| `backend/src/governance/contract/` | Governance functions v1 | Prudence (synced copy) |

Never edit a synced copy: tests check its SHA-256 sums. A change Ernest needs in one of them
starts in the owner's repository, which syncs it here. Removing or retyping a field Prudence
reads fails `backend/test/prudence-contract.test.js`.

## Style

- Small pull requests, one change each, with a message that says why.
- Tests with the change. Evidence already recorded must keep verifying: never change how a
  stored record is hashed or chained.
- No secrets, real personal data or local paths in code, fixtures or docs.

## Security

Report vulnerabilities privately, as `SECURITY.md` describes, never in a public issue.

## License

By contributing you agree that your contribution is licensed under the Apache License 2.0, the
license of this repository (section 5 of the license).
