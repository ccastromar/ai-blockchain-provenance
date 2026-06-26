# Release Checklist

Use this checklist before publishing an official Ernest release.

## Versioning

- [ ] Decide the release tag, for example `v0.1.0-alpha`.
- [ ] Update versions in the root README and component manifests if needed.
- [ ] Update `CHANGELOG.md`.
- [ ] Confirm the release scope is described as PoC, alpha, beta, or stable.

## Reproducibility

- [ ] `backend/package-lock.json`, `frontend/package-lock.json`, and `blockchain/package-lock.json` are committed.
- [ ] `npm ci` works in `backend`, `frontend`, and `blockchain`.
- [ ] `docker compose up --build` starts MongoDB, backend, and frontend.
- [ ] `.env.example` files match the current runtime configuration.
- [ ] `./scripts/smoke.sh` passes against a clean local stack.

## Verification

- [ ] `cd backend && npm run test:integrity`
- [ ] `cd frontend && npm run build`
- [ ] `cd blockchain && npm ci && npx hardhat compile`
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
- [ ] `NEXT_PUBLIC_ERNEST_API_KEY` is used only for browser demos, never as a production secret.
- [ ] Known `npm audit` findings are reviewed and accepted or remediated.

## Blockchain Anchoring

- [ ] `CONTRACT_ADDRESS` points to the intended deployed `ErnestMerkleAnchor`.
- [ ] `INFURA_URL` or RPC provider is configured.
- [ ] `ANCHOR_ORGANIZATION_ID`, `ANCHOR_ORGANIZATION_NAME`, and `ANCHOR_DOMAIN` are correct.
- [ ] `POST /api/anchors` has been tested on the target network if anchoring is part of the release demo.

## Documentation

- [ ] README quickstart works from a clean clone.
- [ ] API examples are valid JSON and match backend validation.
- [ ] Security notes describe PoC limitations honestly.
- [ ] Screenshots are current.
- [ ] License and author sections are accurate.

## GitHub

- [ ] CI is green on `main`.
- [ ] Issue templates are present.
- [ ] `SECURITY.md` has a responsible disclosure path.
- [ ] Release notes link to the changelog.
