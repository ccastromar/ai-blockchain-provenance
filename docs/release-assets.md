# Release Assets

Use this checklist when preparing a public Ernest alpha release.

## GitHub Release

- Title: `Ernest v0.1.0-alpha`
- Tag: `v0.1.0-alpha`
- Mark the release as pre-release.
- Use `docs/releases/v0.1.0-alpha.md` as the release note base.
- Link to `README.md`, `docs/deployment-vps.md`, `docs/security-model.md`, and `docs/dependency-risk.md`.
- For company-facing presentations, also link to `docs/incubation-brief.md`, `docs/presentation-deck.md`, `docs/demo-script.md`, and `docs/maturity-model.md`.
- State clearly that this is a PoC for demos and technical evaluation, not a production compliance system.

## Screenshots

Capture screenshots from the official SvelteKit frontend after `docker compose up --build`:

- Register AI model form.
- Log inference form.
- Provenance view.
- Hashchain stats view.

Save them under `docs/img/` with the existing filenames unless the README is updated at the same time.

## Release Notes

Include:

- SvelteKit dashboard is the official frontend.
- NestJS 11 backend.
- pnpm workspace and lockfile.
- Docker Compose demo stack for a small VPS.
- GHCR images for backend and SvelteKit frontend.
- Optional Sepolia anchoring.
- Known alpha limitations: no full auth, no RBAC, no regulated-workload guarantees.

## Pre-Publish Proof

Attach or paste the latest successful output summary for:

- `pnpm run backend:test`
- `pnpm run frontend:check`
- `pnpm run frontend:build`
- `pnpm run blockchain:compile`
- `pnpm run audit:prod`
- `./scripts/deploy-check.sh` against the release deployment
- `docker compose -f docker-compose.prod.yml pull` with the release image tag
