# Demo Script

Use this script for a 5-minute company or incubator presentation. It assumes the stack is already running and the dashboard is available.

## Setup

- Dashboard: `http://localhost:3000` or the public demo URL.
- API docs: `http://localhost:3001/api/docs` or `/api/docs` behind the proxy.
- Optional terminal ready for `./scripts/deploy-check.sh`.
- If write protection is enabled, have `ERNEST_API_KEY` available.

## Talk Track

### 1. Frame The Problem

AI governance teams need evidence that links models, versions, decisions, and audit events. Ernest demonstrates a narrow provenance layer: it stores hashes and metadata, not raw sensitive AI data.

Key point: Ernest is not replacing a model registry or data platform. It records tamper-evident evidence beside them.

### 2. Register A Model

Open the dashboard and register a model with:

- `modelId`: `credit-risk-logreg-v1`
- `version`: `1.0.0`
- `modelHash`: any valid SHA-256 demo hash
- `gitCommit`: a valid hex commit-like value
- basic params and metrics

Explain:

- The backend validates the payload.
- A provenance block is appended to the MongoDB-backed hashchain.
- The block links to the previous hash.

### 3. Log An Inference

Log an inference for the same model using input and output hashes.

Explain:

- Ernest never needs the raw input or output.
- Client systems hash sensitive values outside Ernest.
- The chain now links model registration to later inference evidence.

### 4. View Provenance

Open the provenance view for the model.

Explain:

- The UI shows the event history for a model.
- Verification recomputes block hashes and `previousHash` links.
- A tampered local record would break verification.

### 5. Show Chain Stats And API Contract

Open stats and Swagger/OpenAPI docs.

Explain:

- The API is intentionally small: register model, log inference, verify chain, anchor root.
- Read endpoints can be integrated into audit reports or internal tools.

### 6. Optional Anchor

If Sepolia credentials are configured, trigger an anchor.

Explain:

- Ernest computes a Merkle root over the local chain.
- Only the root and organizational metadata go on-chain.
- The blockchain provides an external proof of existence, not raw data storage.

### 7. Close With Roadmap

Close with the incubation path:

- Enterprise identity and RBAC.
- Signed client submissions.
- Model registry and inference-system integrations.
- Operational metrics, backup validation, and structured evidence exports.

## Expected Questions

| Question | Short Answer |
| --- | --- |
| Does Ernest store prompts or inference outputs? | No. It stores hashes and metadata only. |
| Is this production-ready? | No. It is an alpha PoC suitable for demos and controlled pilots. |
| What does blockchain add? | Public proof of existence for a Merkle root without publishing private data. |
| Can a client lie about a hash? | In the alpha, yes. Signed submissions are a planned milestone. |
| Does it support enterprise SSO? | Not yet. The current public-demo protection is API-key based. |
| Can this integrate with MLflow or internal registries? | Yes, that is a natural next milestone. |
