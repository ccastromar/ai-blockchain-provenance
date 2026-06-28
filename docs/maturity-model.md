# Maturity Model

This model frames Ernest as an alpha PoC with a clear path toward an enterprise pilot and later production hardening.

| Capability | Alpha PoC | Enterprise Pilot | Production Direction |
| --- | --- | --- | --- |
| Identity | Optional shared API key | OIDC/JWT or API gateway auth | RBAC/ABAC, mTLS, service identities |
| Authorization | Protected write endpoints | Role-based write/read controls | Tenant-aware policy enforcement |
| Provenance writes | Hashchain append with duplicate-key retry | Signed client submissions | Strong serialization or event-log backend |
| Tenant scope | `X-Ernest-Org-Id` demo scoping | Organization-aware access model | Formal tenant isolation and data boundaries |
| Data handling | Hashes and non-sensitive metadata | Data classification rules | Retention, legal hold, deletion workflows |
| Blockchain anchoring | Optional Sepolia root anchoring | Controlled testnet/mainnet policy | Managed custody, approvals, cost controls |
| Deployment | Docker Compose on local/VPS | GHCR images with controlled VPS or lab cloud | HA services, managed database, IaC |
| Observability | Health endpoint and logs | Metrics, traces, and alerting | SLOs, incident response, audit monitoring |
| Backup/restore | Manual MongoDB backup guidance | Scheduled backup validation | DR runbooks and restore objectives |
| Evidence export | API and UI inspection | Structured report exports | GRC/model-risk workflow integration |
| Dependency risk | `audit:prod` gate and documented exceptions | Policy review before releases | SBOM, vulnerability SLAs, provenance attestations |

## Alpha Exit Criteria

Ernest is ready to leave alpha PoC status when:

- A real model registry or ML platform integration is demonstrated.
- Write clients can sign provenance submissions.
- Authentication is delegated to an enterprise identity provider.
- Backup and restore are tested on the target deployment shape.
- A pilot threat model is reviewed with security stakeholders.

## Suggested Pilot Success Metrics

- Time to register a model lifecycle event from an external system.
- Time to retrieve evidence for a model or inference.
- Percentage of submitted events with complete hashes and metadata.
- Chain verification success rate after backup/restore.
- Audit reviewer ability to understand evidence without engineering support.
