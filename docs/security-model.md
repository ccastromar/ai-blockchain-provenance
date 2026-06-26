# Security Model

Ernest is an alpha proof-of-concept. It provides tamper-evident event storage and optional public anchoring, but it is not a full production security or compliance system.

## Goals

Ernest is designed to help answer:

- Was this model registered in the provenance system?
- Was this inference logged for that model?
- Has the local hashchain been modified since records were written?
- Was a Merkle root for this chain anchored to a public testnet at a given time?

## Non-Goals

Ernest does not currently provide:

- Full user authentication.
- Role-based access control.
- Tenant isolation.
- Regulatory compliance by itself.
- Proof that client-submitted hashes were computed honestly.
- Secure custody for raw model artifacts or raw inference inputs/outputs.
- Production-grade key management.

## Trust Assumptions

Ernest assumes:

- Clients compute `modelHash`, `inputHash`, and `outputHash` correctly before calling the API.
- MongoDB is private and writable only by trusted services.
- `ERNEST_API_KEY` is kept secret for server-to-server or controlled demo usage.
- `PRIVATE_KEY` for Sepolia anchoring is stored outside source control and has limited funds.

## Protected Assets

| Asset | Protection |
| --- | --- |
| Hashchain blocks | SHA-256 hash links and unique indexes |
| Append sequence | Duplicate-key retry and `409` conflict handling |
| Write endpoints | Optional `ERNEST_API_KEY` guard |
| Browser access | Configurable `CORS_ORIGIN` |
| Public proof | Sepolia Merkle root anchoring |

## Write Endpoint Protection

If `ERNEST_API_KEY` is set, the following endpoints require `X-Ernest-Api-Key`:

- `POST /api/models`
- `POST /api/inferences`
- `POST /api/anchors`

If `ERNEST_API_KEY` is not set, the API remains open for local demos.

## Data Handling

Inference inputs and outputs should not be sent to Ernest. Clients should hash raw values outside Ernest and send only:

- `inputHash`
- `outputHash`
- non-sensitive metadata

Metadata can still accidentally contain sensitive information. Treat metadata as potentially sensitive and review clients before public demos.

## CORS

Set `CORS_ORIGIN` in public deployments:

```bash
CORS_ORIGIN=https://your-frontend.example
```

Multiple origins can be comma-separated.

## Blockchain Key Safety

For public demos:

- Use a dedicated Sepolia wallet.
- Keep only limited testnet funds.
- Store `PRIVATE_KEY` in a secrets manager or protected environment.
- Never commit `.env` files.

## Production Hardening Backlog

- Replace API key with OAuth/JWT or mTLS.
- Add RBAC and tenant scoping.
- Add request rate limiting.
- Add signed model/inference submissions.
- Add audit logs for write attempts.
- Add structured OpenAPI docs and client SDKs.
- Add stronger append serialization for high-throughput environments.
- Add backup and restore procedures for MongoDB.
