# Documentation Map

## Start Here

- `README.md`: project overview, quickstart, components, verification, and roadmap.
- `docs/quick-eval.md`: 10-minute evaluator path.
- `docs/architecture.md`: system design, trust boundaries and trade-offs.
- `docs/maturity-model.md`: maturity path, from today towards beta and an enterprise pilot.
- `docs/regulatory-mapping.md`: EU AI Act / ISO 42001 / NIST AI RMF record-keeping obligations mapped to Ernest evidence.

## Security

- `docs/security-model.md`: guarantees, non-goals, trust assumptions, and hardening backlog.
- `docs/threat-model.md`: what Ernest detects and what it cannot prevent.
- `SECURITY.md`: vulnerability reporting and security expectations.
- `docs/dependency-risk.md`: dependency audit policy and accepted risks.

## Integrate

- `docs/api.md`: API reference and request examples.
- `docs/event-ingestion-layer.md`: the event-ingestor (HTTP, Redis Streams, Kafka).
- `docs/integrations.md`: current and planned AI tooling integrations.
- `docs/connectors-real-integration.md`: turning simulated provider connectors into real ones.
- `cli-ernest/README.md`: CLI-oriented verification and querying.
- `integrations/mlflow/`: MLflow-to-Ernest registration adapter.
- `ai-sandbox/`: sample AI workflow that registers demo model events.
- `agentic-auditor/`: optional auditor assistant integration.

## Releases

- `CHANGELOG.md`: release history.
