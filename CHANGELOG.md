# Changelog

All notable changes to Ernest will be documented in this file.

The format follows the spirit of Keep a Changelog, and this project uses semantic versioning once releases are tagged.

## [0.1.0-alpha] - Unreleased

### Added

- Full-stack AI provenance PoC with NestJS backend, Next.js frontend, MongoDB hashchain, Go CLI, Rust Merkle helper, Python auditor, and Hardhat contract project.
- Reproducible npm lockfiles for backend, frontend, and blockchain.
- Docker hardening for backend, frontend, CLI, and auditor images.
- `.env.example` files and `.dockerignore` files for release-oriented setup.
- Backend validation for model registration and inference hashes.
- Smoke test script for the local API lifecycle.
- Contract-based Sepolia anchoring through `ErnestMerkleAnchor.anchorRoot`.
- Manual `POST /api/anchors` endpoint for demo anchoring.
- Unique hashchain indexes and append retry handling for concurrent writes.
- Backend integrity tests using Node's native test runner.
- Optional API key protection for write endpoints.
- Configurable CORS origin.
- GitHub Actions CI workflow.
- Release checklist and GitHub issue templates.

### Changed

- README examples now use copyable, valid JSON.
- Iris sandbox now matches the real backend API contract and treats MLflow as optional.
- Frontend model registration now sends valid MLflow hash metadata.
- Debug data-structure endpoint is hidden in production.

### Security

- Optional `ERNEST_API_KEY` protects `POST /api/models`, `POST /api/inferences`, and `POST /api/anchors`.
- Deployment safety checklist documents API key, CORS, MongoDB, and Sepolia private-key expectations.

### Known Limitations

- Full user authentication and RBAC are not implemented.
- Testcontainers-based CLI integration tests require a Docker environment and are not part of default CI.
- Public-chain anchoring requires funded Sepolia credentials and is not exercised in CI.
