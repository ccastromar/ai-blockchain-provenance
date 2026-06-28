# API Reference

Base URL for local development:

```text
http://localhost:3001
```

If `ERNEST_API_KEY` is configured, write endpoints require:

```text
X-Ernest-Api-Key: <key>
```

Some endpoints accept an optional organization scope:

```text
X-Ernest-Org-Id: <organization-id>
```

This is useful for demos and integration testing. It is not a substitute for enterprise tenant isolation or authorization.

Interactive API documentation is available when the backend is running:

- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs-json`

## Health

```http
GET /health
```

Response:

```json
{
  "status": "ok"
}
```

## Register Model

```http
POST /api/models
```

Required fields:

- `modelId`: public model identifier.
- `modelName`: display name.
- `version`: model version.
- `mlflow.modelHash`: SHA-256 hash of the model artifact.
- `mlflow.gitCommit`: short or full hexadecimal Git commit.

Optional organization scoping can be sent either as `organizationId` in the body or as `X-Ernest-Org-Id`. The header takes precedence.

Example:

```bash
curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -H "X-Ernest-Api-Key: <key-if-configured>" \
  -d '{
    "modelId": "credit-risk-logreg-v1",
    "modelName": "Credit Risk logistic regression version 1",
    "version": "1.0.0",
    "mlflow": {
      "modelHash": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45",
      "gitCommit": "a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2"
    },
    "params": {
      "model_type": "LogisticRegression",
      "solver": "liblinear"
    },
    "metrics": {
      "roc_auc": 0.81,
      "accuracy": 0.76
    },
    "metadata": {
      "framework": "scikit-learn",
      "training_data": "German Credit Risk Dataset"
    }
  }'
```

Response:

```json
{
  "success": true,
  "modelId": "credit-risk-logreg-v1",
  "modelName": "Credit Risk logistic regression version 1",
  "version": "1.0.0",
  "blockIndex": 1,
  "blockHash": "2a648a9bb807c0e3f23ecd89f387774f8f5dcd959587ce45dc1ffba31828fa18",
  "mlflow": {
    "modelHash": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45",
    "gitCommit": "a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2"
  },
  "blockchain": {
    "index": 1,
    "hash": "2a648a9bb807c0e3f23ecd89f387774f8f5dcd959587ce45dc1ffba31828fa18",
    "timestamp": 1761562665
  }
}
```

## Log Inference

```http
POST /api/inferences
```

Ernest expects hashes, not raw inference inputs or outputs.

Required fields:

- `modelId`: existing model identifier.
- `inferenceId`: client-generated inference identifier.
- `inputHash`: SHA-256 hash of the raw input.
- `outputHash`: SHA-256 hash of the raw output.

Example:

```bash
curl -X POST http://localhost:3001/api/inferences \
  -H "Content-Type: application/json" \
  -H "X-Ernest-Api-Key: <key-if-configured>" \
  -d '{
    "modelId": "credit-risk-logreg-v1",
    "inferenceId": "f61c7b91-2e83-4f4a-8c9b-7c0cb90fca1e",
    "inputHash": "e13236b63f7c5c5c8e7d1d52ebc4188e85f1dc474f0f3b2186e3b061087df6f5",
    "outputHash": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45",
    "params": {
      "return_probs": true
    },
    "metadata": {
      "source": "branch_app",
      "scoring_request_id": "score-20251027-1001"
    }
  }'
```

Response:

```json
{
  "success": true,
  "inferenceId": "f61c7b91-2e83-4f4a-8c9b-7c0cb90fca1e",
  "modelId": "credit-risk-logreg-v1",
  "blockIndex": 2,
  "blockHash": "e8c59ba5a6cf54ca2140e2b4694e7b0c9c55c826759da5b1869a319143eede61",
  "hashes": {
    "input": "e13236b63f7c5c5c8e7d1d52ebc4188e85f1dc474f0f3b2186e3b061087df6f5",
    "output": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45"
  },
  "blockchain": {
    "index": 2,
    "hash": "e8c59ba5a6cf54ca2140e2b4694e7b0c9c55c826759da5b1869a319143eede61",
    "timestamp": 1761562689
  }
}
```

## Get Provenance

```http
GET /api/provenances/:modelId
```

Returns all hashchain blocks for a model and includes current chain verification status.
Accepts optional `type`, `from`, and `to` query filters. `X-Ernest-Org-Id` can scope results by organization.

## Get Stats

```http
GET /api/stats
```

Returns total blocks, model count, last block, chain verification status, and latest anchor metadata if available.

## Verify Chain

```http
GET /api/verify
```

Response:

```json
{
  "isValid": true,
  "errors": []
}
```

## Blocks

```http
GET /api/blocks
GET /api/blocks/:index
```

Returns raw hashchain blocks. `GET /api/blocks/:index` returns `404` when the block is missing.

## Anchor Merkle Root

```http
POST /api/anchors
```

Manually computes the current Merkle root and submits it to the configured `ErnestMerkleAnchor` contract. Requires `INFURA_URL`, `PRIVATE_KEY`, and `CONTRACT_ADDRESS`.

Example:

```bash
curl -X POST http://localhost:3001/api/anchors \
  -H "X-Ernest-Api-Key: <key-if-configured>"
```

## Anchor Events

```http
GET /api/events
GET /api/events/address?address=0x...
GET /api/events/organization?orgId=ernest-demo
```

Reads `Anchored` events from the configured contract. Requires `INFURA_URL` and `CONTRACT_ADDRESS`.

## Model Helpers

```http
GET /api/models
GET /api/models/:modelId
GET /api/models/ids
```

These endpoints are read-only. Model creation should go through `POST /api/models` on the main API controller so provenance blocks are appended.

## Errors

Common responses:

| Status | Meaning |
| --- | --- |
| `400` | Validation error |
| `401` | Missing or invalid Ernest API key |
| `404` | Resource not found |
| `409` | Duplicate resource or append race exhaustion |
| `503` | Optional blockchain integration is not configured |
