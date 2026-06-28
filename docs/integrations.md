# Integrations

Ernest is designed to sit beside existing AI platforms. Integrations should submit hashes and non-sensitive metadata to Ernest while leaving raw prompts, inference payloads, training data, and model artifacts in the source systems.

## Current Integration

### Audit Readiness

The SvelteKit dashboard includes an evidence-readiness review at `/auditor`.

It can:

- Load model, provenance, chain stats, and verification evidence from Ernest.
- Show the end-to-end flow from MLflow-style registration evidence to Ernest provenance, inference hashes, hashchain verification, and anchoring.
- Produce deterministic readiness checks without calling an external LLM.
- Export a Markdown evidence packet for reviewers.
- Optionally load WebLLM in WebGPU-capable browsers to draft a local audit memo.

The WebLLM path is deliberately optional: the add-on stays useful in locked-down browsers, CI builds, and simple VPS demos where local model loading is not available.

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

### MLflow E2E Demo

The repository also includes a Docker Compose overlay that runs MLflow in the background and executes the Iris sandbox as a one-shot demo job:

```bash
./scripts/mlflow-e2e.sh
```

That flow:

1. Starts MongoDB, backend, frontend, and MLflow.
2. Trains an Iris KNN model.
3. Logs params, metrics, and the model artifact to MLflow.
4. Registers the model evidence in Ernest.
5. Logs one inference hash event in Ernest.
6. Leaves the model visible in `/auditor` for Audit Readiness review.

Manual Compose equivalent:

```bash
docker compose -f docker-compose.yml -f docker-compose.mlflow.yml up -d --build mongodb backend frontend mlflow
docker compose -f docker-compose.yml -f docker-compose.mlflow.yml run --rm mlflow-demo
```

The MLflow service uses `--allowed-hosts "*"` in the demo overlay so the browser and Docker-network job can both call the tracking server without DNS-rebinding host-header failures. The service is bound to `127.0.0.1` on the host and is intended for local PoC use only.

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
