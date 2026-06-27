# Release Checklist

Use this checklist before publishing an official Ernest release.

## Versioning

- [ ] Decide the release tag, for example `v0.1.0-alpha`.
- [ ] Update versions in the root README and component manifests if needed.
- [ ] Update `CHANGELOG.md`.
- [ ] Confirm the release scope is described as PoC, alpha, beta, or stable.

## Reproducibility

- [ ] `pnpm-lock.yaml` is committed.
- [ ] `pnpm install --frozen-lockfile` works from the repository root.
- [ ] `docker compose up --build` starts MongoDB, backend, and frontend.
- [ ] Docker Compose serves the SvelteKit frontend, not the deprecated Next.js frontend.
- [ ] `docker compose ps` reports healthy MongoDB, backend, and frontend services.
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
- [ ] `bash -n scripts/smoke.sh setup.sh`

## Security

- [ ] `ERNEST_API_KEY` is set for any public deployment.
- [ ] `CORS_ORIGIN` is restricted to controlled frontend origins.
- [ ] MongoDB is private and not exposed to the public internet.
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
- [ ] `docs/security-model.md` describes current guarantees and non-goals.
- [ ] Security notes describe PoC limitations honestly.
- [ ] Screenshots are current.
- [ ] License and author sections are accurate.

## GitHub

- [ ] CI is green on `main`.
- [ ] Issue templates are present.
- [ ] `SECURITY.md` has a responsible disclosure path.
- [ ] Release notes link to the changelog.
