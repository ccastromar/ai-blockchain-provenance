# Changelog

All notable changes to Ernest will be documented in this file.

The format follows the spirit of Keep a Changelog, and this project uses semantic versioning once releases are tagged.

## [Unreleased]

Ernest 0.3.0 ships in Chestertown 0.1.0, with AOS (orchestrate) and Prudence (govern).

### Changed

- **License: Apache-2.0** (was MIT).
- **Authorization by governance function** (Chestertown contract `chestertown.governance/v1`). Every caller resolves to functions through the organization's governance model (`ERNEST_GOVERNANCE_MODEL`, or the packaged default that maps `ernest-editor` and `ernest-reader`): `evidence.write` writes evidence, `platform.admin` operates Ernest (access tokens, emitter keys, manual anchors, legal holds) and any function reads. Writing evidence no longer implies operating Ernest. `whoami` reports the functions; `OIDC_ROLE_CLAIM` and `OIDC_ROLE_MAP` are no longer read. Static keys keep working: the read-write key holds both functions and the read-only key `audit`.
- The web console is now React 19 + Vite + TypeScript in `frontend/`, built on the shared Chestertown design system (`@chestertown/design`, vendored), with the same screens, URLs and `PUBLIC_*` build variables as the SvelteKit console it replaces; `frontend-svelte/` is removed. It is a standalone npm project outside the pnpm workspace.
- Console: Overview is the landing page (chain, anchoring and service health, with when the next anchor fires); manual evidence entry moved to Demo, offered only to `evidence.write`; provenance filters and exports live on the model page; blocks list newest first; one navigation bar with the Chestertown app switcher on every page. The whole console stays behind sign-in, and a signed-in user without a function gets a no-access page.
- Models: records from Prudence are listed apart from AI models and titled by the system's name; their status is managed in Prudence (a status change here is refused with 409), and "Governed by Prudence" opens the system in Prudence's registry. AOS execution events link to their run in the AOS console.
- Dependencies: production advisories cleared (pnpm 11 audit gate in CI); Go 1.26.10 for the event-ingestor and CLI.

### Added

- **AOS's audit events contract, checked in the event-ingestor.**
  `event-ingestor/internal/kafkasource/contract_test.go` reads every Kafka record AOS publishes
  (`testdata/aos-audit-events/`, synced from AOS with SHA-256 sums) through the Kafka source and
  `events.Normalize`, and checks the deduplication id, the model, and `stage: execution` with
  the AI system for a governed pipeline's start.
- **Prudence's evidence contract, verified.** `backend/test/prudence-contract.test.js` boots the
  backend with batching on, as the suite deploys it, and replays what Prudence sends and reads
  (`backend/test/contracts/prudence-evidence/`, synced from prudence-governance with SHA-256
  sums): duplicates, conflicts, the inclusion proof Prudence verifies, Posture's reads. A field
  Prudence reads cannot be removed or retyped without failing it.
- Merkle-batched evidence, ADR-004 rollout steps 1–2 (behind `EVIDENCE_BATCHING`, default `off`): `evidence_events` store with idempotent submission by `(source, eventId)` (same content → 200 with the stored record, different content → 409); a leased single-leader batcher that chains either one ordinary block per event (`events`, chain shape unchanged) or one `batch` block per interval committing to its events through an RFC 6962 SHA-256 root (`on`); `?wait=true` on submissions; `GET /api/events/{source}/{eventId}/proof` (audit path + block + anchor receipt); `verifyChain` re-derives every batch root from its events. Crash-resume and double-leader safety via a unique `eventSeq` index on blocks.
- ADR-004 rollout steps 3–4 and verifiers: the event-ingestor writes `evidence_events` under `EVIDENCE_BATCHING` (status `recorded`, metric `ernest_writer_events_recorded_total`); provenance, per-model integrity and stats read batched events (provenance entries carry `seq`/`leafIndex`/`proofUrl`; provenance verification is incremental); `GET /api/events/export`; RFC 6962 verification in the Go CLI (`proof verify` accepts event proofs, `hashchain verify` re-derives batch roots, `--events` for offline bundles) and in merkle-wasm (`verify_event_proof`, used by `/verify-receipt`); `testdata/rfc6962-golden.json` pinning leaves, roots, audit paths and the Certificate Transparency reference tree.
- Signed submissions (ADR-001): per-emitter Ed25519 signatures over DSSE PAE of the same RFC 8785 canonical bytes the block hash uses. Emitter keys are registered/revocable via `POST/GET/DELETE /api/auth/emitters` (admission control only — the envelope embeds the key, so receipts, the CLI and the browser/WASM verifier check authorship fully offline, and history signed while a key was valid stays attributable after revocation). Enforcement via `SIGNED_SUBMISSIONS=off|optional|required`; invalid envelopes are never stored. Pinned cross-language by `testdata/signed-submission-golden.json` in backend, Go and Rust golden tests; tooling: `ernest emitter keygen` + `integrations/signing/sign-submission.mjs` (round-trip validated Go→Node→backend).
- OpenTimestamps anchoring provider (`ANCHOR_PROVIDER=ots`): stamps Merkle roots against the public OTS calendars — free, keyless Bitcoin attestation with no crypto custody, eliminating the anchor-wallet threat-model gap for the recommended production configuration. Proofs start pending and are upgraded to confirmed (with the attested Bitcoin block height) by the existing anchor-confirmation cycle; the Merkle root is stamped with OTS `fromBytes` so the proof is verifiable with the official client against a raw file — `GET /api/anchors/:id/ots` serves the `.ots` proof and `GET /api/anchors/:id/ots/raw` the 32 root bytes, and `ots verify -f ernest-anchor-<id> ernest-anchor-<id>.ots` confirms it. Receipts and the stats card expose both download URLs. Interop validated end-to-end against the official Python `ots` client (no hash-mismatch; pending Bitcoin confirmation).
- Continuous MLflow integration: `integrations/mlflow/watch_mlflow.py` polls the MLflow model registry (OSS MLflow has no webhooks) and mirrors every new model version into Ernest as tamper-evident provenance, reusing the adapter's artifact-hashing payload mapping. Crash-safe by design: Ernest's duplicate rejection makes re-submissions idempotent, and the watermark only advances past durably recorded versions. Ships as the `mlflow-watcher` compose service with `scripts/mlflow-watcher-e2e.sh` proving the hands-off path (train in MLflow only, assert Ernest provenance appears).
- **OIDC caller identity and SSO** (ADR-002 Decision A): bearer JWTs validated against the issuer's JWKS (opt-in via `OIDC_ISSUER`/`OIDC_AUDIENCE`), alongside static keys and access tokens. The console signs in with authorization code + PKCE, renews tokens silently (15-minute tokens, 8-hour idle SSO), and signs out suite-wide (RP-initiated logout; a sign-out in another Chestertown app is detected by a silent session check).
- **Qualified trust services** (ADR-002 Decision B): an RFC 3161 timestamp over each anchored Merkle root from a TSA (`ANCHOR_QTS_ENABLED`, `QTS_TSA_URL`; fail-soft, alerted, served at `GET /api/anchors/:id/tst`), and an eIDAS qualified electronic seal envelope (`SEAL_LEVEL=qualified`, X.509 chain to `QSEAL_TRUSTED_CA_PEM`) verified offline in the Go CLI and Rust/WASM, pinned by a golden fixture. Ernest is not a qualified trust service provider; it consumes one.
- **Data lifecycle** (ADR-003): a retention floor (`RETENTION_MIN_DAYS`), legal holds (global, organization or model), a non-destructive retention plan and a verifiable archive export under `/api/lifecycle`. Pruning and crypto-shredding remain design-only.
- **High-volume evidence**: process roles (`ERNEST_ROLE=reader|writer|chainer`) for read replicas, scalable writers and a single chainer; `POST /api/inferences/batch` and a bulk ingestor worker; a Kafka source for the event-ingestor (ADR-005; consumer group over `KAFKA_TOPICS`, TLS and SASL, offsets committed only after recording); chain-derived read models validated block by block as they are indexed (ADR-006); a per-key rate limit for authenticated ingest callers; `GET /api/stats/models` for many models in one call.
- **Prudence evidence**: the ingestor understands `policy.decision` events and their `aiSystem` identity block; models record their system of record, AI system id and risk tier field by field, and an event only updates what it carries. Each AI system's latest execution time is reported.
- Public read-only evidence access (`ERNEST_PUBLIC_READ_ONLY=true`): visitors may read with safe HTTP methods; every write still needs `evidence.write`.
- Backend health also at `/api/health`, so the console reaches it through nginx.
- Opt-in clock drift detection: when `NTP_CHECK_SERVER` is set, the hourly integrity check measures local clock offset via SNTP (dependency-free RFC 4330 client), records it with the check, and alerts `WEBHOOK_URL` (`clock.drift.exceeded`) beyond `NTP_MAX_DRIFT_MS` — drift is detected instead of silently notarized into block timestamps (threat model N3).

### Fixed

- Signed submissions rejected valid signatures when optional fields were omitted.
- The console no longer shows an unverified chain as compromised: only a verification that ran and failed does.
- `scripts/smoke.sh` works on macOS bash 3.2.
- CHANGELOG backfilled with the previously untracked `v0.1.1-alpha` tag; removed a stale duplicate env template; keyed `bson.D` literals in the CLI repositories (`go vet` clean).

## [0.2.0-alpha] - 2026-07-04

### Added

- Read-only vs. read-write access roles: `ERNEST_READ_API_KEY` alongside the existing write key, enforced globally (every route except `/health` and `/api/auth/whoami`).
- Named, revocable access tokens for auditors and teams (`POST/GET/DELETE /api/auth/tokens`): SHA-256-hashed at rest, role-scoped, optionally expiring, with last-used tracking. Issued and revoked from the new `/settings/tokens` page.
- Login page (`/login`) replacing the header key popup; the role badge links to it and write actions disable under a read-only credential.
- Hourly automated chain-integrity check (plus once at startup): result recorded, surfaced in `/health`, and POSTed to `WEBHOOK_URL` when the chain is broken.
- MongoDB backup/restore scripts (`scripts/backup-mongo.sh`, `scripts/restore-mongo.sh`) and a recovery runbook (`docs/backup-recovery.md`).
- Hashchain block explorer page with per-block detail, chain-link verification and jump-to-index.
- CycloneDX 1.6 AI/ML-BOM export for model provenance.
- Cross-language hash consensus suite: `testdata/hash-golden-vectors.json` pins the canonicalization (RFC 8785 plus excluded keys) byte-for-byte across the NestJS backend, the Go event-writer and the Go CLI; golden tests run in all three CI jobs.
- CLI chain verification without database credentials: `ernest hashchain verify --api` (a read-only key suffices) and `--file` for offline verification of the new `GET /api/blocks/export` bundle; direct-Mongo mode remains for forensic use.
- Event-writer number normalization: all event numbers are pinned to doubles before hashing and storage, and integers beyond 2^53 are rejected to the DLQ instead of silently forking consensus between JS and Go verifiers.
- SPV-style inclusion receipts: `GET /api/blocks/:index/proof` emits a self-contained evidence bundle (block, Merkle proof path, anchored root, anchor transaction) connecting one block to its covering confirmed anchor; `ernest proof verify receipt.json` verifies it fully offline — data-to-hash, hash-to-root — pinned cross-language by `testdata/merkle-proof-golden.json`. The endpoint also refuses to emit receipts when the local chain no longer reproduces the anchored root, which is itself tamper evidence.
- In-browser receipt verification: the block explorer gains a per-block "Receipt" download button and a `/verify-receipt` page that verifies receipts entirely client-side via WebAssembly — `merkle-wasm` (Rust) now implements Ernest's canonicalization, block hashing and keccak256 proof walking, pinned to the same golden fixtures as every other implementation by `cargo test` in CI. Nothing leaves the auditor's browser.
- Checkpointed integrity monitoring: the hourly check now verifies incrementally from the last trusted checkpoint (O(new blocks) instead of O(chain)), re-validates the latest confirmed anchor's Merkle root every run (the check with external teeth), and falls back to a full re-scan every `INTEGRITY_FULL_SCAN_HOURS` (default 24) — the only pass that catches data edited under an untouched stored hash. Chain verification streams blocks with a cursor, and `/api/verify` now reports `blocksVerified` and the checkpoint.
- Constant-memory chain export: `GET /api/blocks/export` streams the JSON bundle from a Mongo cursor instead of materializing the whole chain in RAM, making offline-audit exports viable for million-block chains. Same format, same CLI compatibility.

### Changed

- Model registration is serialized through the unique `(modelId, version)` document index: a concurrent duplicate registration fails with 400 before touching the hashchain, and a failed block append compensates by removing the document.
- `POST /api/inferences` returns 409 until the model's registration block is committed, so an inference block can never precede its model's registration in the chain.
- Block timestamps are monotonic in both writers: never below the previous block's timestamp, keeping wall-clock claims consistent with the authoritative index order.
- Threat model rewritten around explicit guarantees and non-guarantees (`docs/threat-model.md`).
- Go event-writer canonicalization conformed to RFC 8785 (no HTML escaping, ECMAScript number notation, UTF-16 key order).
- Removed the deprecated Next.js frontend; `frontend-svelte/` is the only dashboard.

### Fixed

- Event-writer crash-loop on `IndexOptionsConflict` when Mongoose had already created equivalent indexes under different auto-generated names (provenanceblocks, ingested_events and event_failures).
- `PATCH /api/models/:id/status` was missing the write guard, allowing status changes with a read-only credential via direct API call.
- CLI `hashchain verify` compared hashes against empty block data (nested BSON documents decode as `primitive.M`, which its type assertion never matched), re-cleaned stored data at verify time, and remapped the whole chain once per block.
- Block explorer "next block" button 404ing past the chain tip.
- Event E2E scripts failing with 401 against a key-gated backend.
- Docker image rebuilds silently broken by Dockerfiles still copying the deleted legacy frontend's `package.json`.

## [0.1.1-alpha] - 2026-06-29

### Fixed

- MLflow demo host checks and artifact handling.
- CI pipeline: corepack-pinned pnpm and Svelte environment fixes.
- Audit Readiness integrity flag; added frontend unit tests.

## [0.1.0-alpha] - 2026-06-28

### Added

- Full-stack AI provenance PoC with NestJS backend, SvelteKit frontend, MongoDB hashchain, Go CLI, Rust Merkle helper, Python auditor, and Hardhat contract project.
- Reproducible pnpm lockfile for backend, frontends, and blockchain.
- Docker hardening for backend, frontend, CLI, and auditor images.
- `.env.example` files and `.dockerignore` files for release-oriented setup.
- Backend validation for model registration and inference hashes.
- Smoke test script for the local API lifecycle.
- pnpm dependency audit scripts and dependency risk documentation.
- Contract-based Sepolia anchoring through `ErnestMerkleAnchor.anchorRoot`.
- Manual `POST /api/anchors` endpoint for demo anchoring.
- Optional local Hardhat blockchain stack for self-contained anchoring demos.
- `GET /api/anchors/status` endpoint for anchoring mode and RPC reachability.
- Unique hashchain indexes and append retry handling for concurrent writes.
- Backend integrity tests using Node's native test runner.
- Svelte frontend unit tests for Audit Readiness scoring and evidence normalization.
- Optional API key protection for write endpoints.
- Configurable CORS origin.
- Swagger UI and OpenAPI JSON for the public API contract.
- VPS deployment guide and post-deploy health check script.
- pnpm workspace with a single JavaScript lockfile for backend, frontend, Svelte frontend, and blockchain.
- GitHub Actions CI workflow.
- GitHub Actions workflows for Docker smoke checks and GHCR image publishing.
- Incubation brief and documentation map for company-facing evaluation.
- MLflow integration adapter for registering existing MLflow runs in Ernest.
- MLflow Docker Compose demo stack and `scripts/mlflow-e2e.sh` for train-to-audit evaluation.
- Audit Readiness add-on with deterministic evidence checks and optional browser-side WebLLM memo drafting.
- Release checklist and GitHub issue templates.
- Publication-oriented README, architecture guide, API reference, and security model.

### Changed

- Backend NestJS packages now target NestJS 11.
- Docker Compose binds service ports to localhost, adds healthchecks, and rotates container logs.
- JavaScript Docker and CI flows now install dependencies with pnpm.
- Docker Compose now serves the SvelteKit frontend as the official dashboard.
- Docker Compose production deployment can pull prebuilt GHCR backend and frontend images.
- Node.js runtime and CI jobs now target Node 24.
- Generated SvelteKit output is no longer tracked in git.
- README examples now use copyable, valid JSON.
- Iris sandbox now matches the real backend API contract and treats MLflow as optional.
- Frontend model registration now sends valid MLflow hash metadata.
- Debug data-structure endpoint is hidden in production.

### Security

- Optional `ERNEST_API_KEY` protects `POST /api/models`, `POST /api/inferences`, and `POST /api/anchors`.
- Dependency audit policy documents current high-severity findings and release decisions.
- Deployment safety checklist documents API key, CORS, MongoDB, and Sepolia private-key expectations.

### Known Limitations

- Full user authentication and RBAC are not implemented.
- Testcontainers-based CLI integration tests require a Docker environment and are not part of default CI.
- Public-chain anchoring requires funded Sepolia credentials and is not exercised in CI.
