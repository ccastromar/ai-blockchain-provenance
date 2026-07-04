# Changelog

All notable changes to Ernest will be documented in this file.

The format follows the spirit of Keep a Changelog, and this project uses semantic versioning once releases are tagged.

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
