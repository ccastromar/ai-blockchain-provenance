# Quick Evaluation

Use this page when someone has 10 minutes to evaluate Ernest.

## 1 Minute Summary

Ernest is an alpha PoC for AI provenance. It records model lifecycle events and inference evidence as hashes and metadata, verifies a local hashchain, and can optionally anchor Merkle roots to Sepolia.

It is useful for:

- AI auditability demos.
- Internal model governance evaluations.
- Incubator review of provenance and evidence patterns.
- Synthetic-data pilots.

It is not yet:

- A production compliance system.
- An SSO/RBAC platform.
- A full model registry.
- A storage system for raw prompts, inputs, outputs, or model artifacts.

## Run

Local build:

```bash
docker compose up -d --build
./scripts/deploy-check.sh
```

MLflow E2E demo:

```bash
./scripts/mlflow-e2e.sh
```

Prebuilt images:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
./scripts/deploy-check.sh
```

## What To Inspect

- `README.md`: overview and quickstart.
- `docs/incubation-brief.md`: business-facing evaluation summary.
- `docs/architecture.md`: system and deployment architecture.
- `docs/threat-model.md`: security gaps and mitigations.
- `docs/maturity-model.md`: alpha-to-enterprise path.
- `docs/integrations.md`: AI tooling integrations.
- `/auditor`: Audit Readiness evidence review, score dimensions, and optional browser-side WebLLM memo.

## Demo Flow

1. Open the dashboard and click **Seed demo** for a ready-to-audit credit-risk packet.
2. Open Audit Readiness and review the score, checks, and recommended actions.
3. Export the evidence packet.
4. View model provenance.
5. Verify the hashchain.
6. Show API docs.
7. Optionally run `./scripts/mlflow-e2e.sh` to create a model from MLflow evidence instead.
8. Optionally anchor a Merkle root.

## Evaluation Questions

- Which model registry or ML platform would feed Ernest?
- Which applications should submit inference hashes?
- Which metadata fields are safe to store?
- Where should authentication and authorization live?
- Is public anchoring useful, or is local tamper evidence enough?
- What evidence export would auditors or model-risk reviewers need?
