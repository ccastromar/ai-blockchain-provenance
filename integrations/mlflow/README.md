# MLflow Integration

This integration registers an MLflow run or registered model version in Ernest.

It reads metadata from MLflow, computes a deterministic SHA-256 hash for the selected artifact, and sends a `POST /api/models` request to Ernest.

## Use Cases

- Register a trained MLflow run as an Ernest model lifecycle event.
- Preserve MLflow params, metrics, tags, run ID, experiment ID, and artifact URI in Ernest metadata.
- Keep raw model artifacts outside Ernest while storing tamper-evident evidence.

## Requirements

Install the integration dependencies in your Python environment:

```bash
pip install mlflow
```

The script uses only Python standard-library HTTP for the Ernest API call.

## One-Command Demo

Run the full local MLflow-to-Ernest flow:

```bash
./scripts/mlflow-e2e.sh
```

This starts MLflow, trains the Iris sandbox model, logs MLflow params/metrics/artifacts, registers the model in Ernest, records an inference, and leaves the model ready in Audit Readiness at `http://localhost:3000/auditor`.

## Register By Run ID

```bash
python integrations/mlflow/register_mlflow_run.py \
  --tracking-uri http://127.0.0.1:8111 \
  --run-id <mlflow-run-id> \
  --artifact-path model \
  --model-id iris-classifier-v1 \
  --model-name "Iris classifier" \
  --version 1.0.0
```

## Register Latest Model Version

```bash
python integrations/mlflow/register_mlflow_run.py \
  --tracking-uri http://127.0.0.1:8111 \
  --registered-model-name tracking-quickstart \
  --model-id tracking-quickstart \
  --model-name "Tracking quickstart" \
  --version latest
```

## Environment Variables

- `MLFLOW_TRACKING_URI`: default tracking URI.
- `ERNEST_API_BASE`: Ernest API base URL, default `http://localhost:3001/api`.
- `ERNEST_API_KEY`: optional API key sent as `X-Ernest-Api-Key`.
- `ERNEST_ORG_ID`: optional organization scope sent as `X-Ernest-Org-Id`.

## Dry Run

Use `--dry-run` to print the payload without sending it:

```bash
python integrations/mlflow/register_mlflow_run.py --run-id <run-id> --dry-run
```

## Notes

- If `--artifact-path` is omitted, the script tries common MLflow model artifact paths.
- If no artifact can be downloaded, the script hashes stable run metadata as a fallback and records that in `metadata.artifactHashSource`.
- Ernest still trusts the integration client to read the correct MLflow run. For enterprise pilots, pair this with signed submissions and service identity.
