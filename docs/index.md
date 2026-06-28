# Documentation Map

Use this map when presenting Ernest to evaluators, incubator reviewers, or technical stakeholders.

## Start Here

- `README.md`: project overview, quickstart, components, verification, and roadmap.
- `docs/incubation-brief.md`: company-facing summary for an IT incubator or internal sponsor.
- `docs/architecture.md`: system design, deployment view, trust boundaries, trade-offs, and roadmap.
- `docs/security-model.md`: guarantees, non-goals, trust assumptions, and hardening backlog.

## Build And Operate

- `docs/deployment-vps.md`: single-node Docker Compose deployment on a small VPS.
- `docker-compose.yml`: local build-oriented stack.
- `docker-compose.prod.yml`: GHCR image-based deployment stack.
- `.github/workflows/ci.yml`: test/build CI.
- `.github/workflows/docker-smoke.yml`: manual Docker Compose smoke test.
- `.github/workflows/publish-images.yml`: GHCR image publication.

## Integrate

- `docs/api.md`: API reference and request examples.
- `cli-ernest/README.md`: CLI-oriented verification and querying.
- `ai-sandbox/`: sample AI workflow that registers demo model events.
- `agentic-auditor/`: optional auditor assistant integration.

## Release And Risk

- `CHANGELOG.md`: release history.
- `docs/releases/v0.1.0-alpha.md`: alpha release notes.
- `docs/release-checklist.md`: pre-release checklist.
- `docs/release-assets.md`: release asset checklist.
- `docs/dependency-risk.md`: dependency audit policy and accepted alpha risks.
- `SECURITY.md`: vulnerability reporting and security expectations.
