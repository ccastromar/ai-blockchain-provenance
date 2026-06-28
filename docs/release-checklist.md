# Release Checklist

Use this checklist before publishing an official Ernest release.

## Versioning

- [ ] Decide the release tag, for example `v0.1.0-alpha`.
- [ ] Update versions in the root README and component manifests if needed.
- [ ] Update `CHANGELOG.md`.
- [ ] Prepare release notes under `docs/releases/`.
- [ ] Confirm the release scope is described as PoC, alpha, beta, or stable.

## Reproducibility

- [ ] `pnpm-lock.yaml` is committed.
- [ ] `pnpm install --frozen-lockfile` works from the repository root.
- [ ] The `Publish Images` workflow has pushed backend and frontend images to GHCR.
- [ ] The `Release` workflow has attached downloadable `.tar.gz`, `.zip`, and `SHA256SUMS` assets.
- [ ] `docker compose up --build` starts MongoDB, backend, and frontend.
- [ ] `docker compose -f docker-compose.prod.yml pull` works with the selected image tag.
- [ ] Docker Compose serves the SvelteKit frontend, not the deprecated Next.js frontend.
- [ ] `docker compose ps` reports healthy MongoDB, backend, and frontend services.
- [ ] The manual GitHub Actions `Docker Smoke` workflow passes before tagging.
- [ ] `.env.example` files match the current runtime configuration.
- [ ] `./scripts/smoke.sh` passes against a clean local stack.
- [ ] `./scripts/deploy-check.sh` passes against the target deployment URL.

## Verification

- [ ] `pnpm run backend:test`
- [ ] `pnpm run frontend:check`
- [ ] `pnpm run frontend:build`
- [ ] `pnpm run blockchain:compile`
- [ ] `pnpm run audit:prod`
- [ ] `pnpm run audit:all` findings are reviewed before tagging.
- [ ] `cd merkle-wasm && cargo test`
- [ ] `cd cli-ernest && go test ./cmd/... ./internal/db/repositories/...`
- [ ] `python -m compileall ai-sandbox/domains/iris agentic-auditor/app`
- [ ] `bash -n scripts/smoke.sh scripts/deploy-check.sh setup.sh agentic-auditor/run.sh`

## Security

- [ ] `ERNEST_API_KEY` is set for any public deployment.
- [ ] `CORS_ORIGIN` is restricted to controlled frontend origins.
- [ ] MongoDB is private and not exposed to the public internet.
- [ ] The VPS firewall exposes only SSH, HTTP, and HTTPS.
- [ ] `.env` files on the VPS are readable only by the deploy user.
- [ ] Backups are rotated and important snapshots are copied off the VPS.
- [ ] `PRIVATE_KEY` is stored in a secrets manager, not in `.env` committed files.
- [ ] Sepolia demo wallet has only limited funds.
- [ ] `PUBLIC_ERNEST_API_KEY` is used only for browser demos, never as a production secret.
- [ ] Known `pnpm audit` findings are reviewed and accepted or remediated.
- [ ] `docs/dependency-risk.md` reflects current dependency risk decisions.

## Blockchain Anchoring

- [ ] `CONTRACT_ADDRESS` points to the intended deployed `ErnestMerkleAnchor`.
- [ ] `INFURA_URL` or RPC provider is configured.
- [ ] `ANCHOR_ORGANIZATION_ID`, `ANCHOR_ORGANIZATION_NAME`, and `ANCHOR_DOMAIN` are correct.
- [ ] `POST /api/anchors` has been tested on the target network if anchoring is part of the release demo.

## Documentation

- [ ] README quickstart works from a clean clone.
- [ ] API examples are valid JSON and match backend validation.
- [ ] `docs/api.md` matches current backend endpoints and DTO validation.
- [ ] `http://localhost:3001/api/docs` and `/api/docs-json` load correctly.
- [ ] `docs/deployment-vps.md` matches the current Docker Compose setup.
- [ ] `docs/dependency-risk.md` matches current audit expectations.
- [ ] `docs/architecture.md` matches the deployed stack.
- [ ] `docs/demo-script.md`, `docs/maturity-model.md`, and `docs/threat-model.md` match the current alpha scope.
- [ ] `docs/security-model.md` describes current guarantees and non-goals.
- [ ] Security notes describe PoC limitations honestly.
- [ ] Screenshots are current.
- [ ] Release assets follow `docs/release-assets.md`.
- [ ] License and author sections are accurate.

## GitHub

- [ ] CI is green on `main`.
- [ ] Issue templates are present.
- [ ] `SECURITY.md` has a responsible disclosure path.
- [ ] Release notes link to the changelog.
