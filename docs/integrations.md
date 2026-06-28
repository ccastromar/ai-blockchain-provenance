# Integrations

Ernest is designed to sit beside existing AI platforms. Integrations should submit hashes and non-sensitive metadata to Ernest while leaving raw prompts, inference payloads, training data, and model artifacts in the source systems.

## Current Integration

### MLflow

The first integration lives in `integrations/mlflow/`.

It can:

- Read an MLflow run by run ID.
- Resolve the latest version of a registered MLflow model.
- Hash a downloaded model artifact deterministically.
- Preserve MLflow params, metrics, tags, run ID, experiment ID, and artifact URI as Ernest metadata.
- Register the model lifecycle event through `POST /api/models`.

Example:

```bash
python integrations/mlflow/register_mlflow_run.py \
  --tracking-uri http://127.0.0.1:8111 \
  --registered-model-name tracking-quickstart \
  --model-id tracking-quickstart \
  --model-name "Tracking quickstart" \
  --version latest
```

Use `--dry-run` to inspect the Ernest payload before sending it.

## Recommended Next Integrations

| Integration | Value |
| --- | --- |
| OpenAI-compatible proxy | Logs prompt/output hashes for LLM calls without changing clients heavily |
| LangChain callback handler | Captures chain, tool, prompt, and output evidence from existing LLM apps |
| LlamaIndex callback handler | Captures retrieval and generation provenance |
| SageMaker / Vertex AI / Azure ML registries | Connects Ernest to enterprise model lifecycle systems |
| Langfuse / Helicone / Arize Phoenix | Complements LLM observability with tamper-evident evidence |
| GRC / ticketing export | Turns provenance into audit-review artifacts |

## Integration Principles

- Hash raw data outside Ernest.
- Send only hashes and non-sensitive metadata.
- Include stable IDs from the source platform.
- Prefer signed submissions for enterprise pilots.
- Preserve enough metadata to let auditors trace back to the source system.
