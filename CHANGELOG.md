# Changelog

All notable changes to Ernest will be documented in this file.

The format follows the spirit of Keep a Changelog, and this project uses semantic versioning once releases are tagged.

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
- Unique hashchain indexes and append retry handling for concurrent writes.
- Backend integrity tests using Node's native test runner.
- Optional API key protection for write endpoints.
- Configurable CORS origin.
- Swagger UI and OpenAPI JSON for the public API contract.
- VPS deployment guide and post-deploy health check script.
- pnpm workspace with a single JavaScript lockfile for backend, frontend, Svelte frontend, and blockchain.
- GitHub Actions CI workflow.
- GitHub Actions workflows for Docker smoke checks and GHCR image publishing.
- Incubation brief and documentation map for company-facing evaluation.
- MLflow integration adapter for registering existing MLflow runs in Ernest.
- Local WebLLM auditor add-on with deterministic fallback evidence checks.
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
