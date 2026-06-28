# Incubation Brief

Ernest is an alpha proof-of-concept for AI provenance and blockchain anchoring. It is designed to show how an organization can record model lifecycle events and inference evidence without storing raw sensitive AI data in a new platform.

## Problem

AI systems are increasingly expected to answer operational and audit questions:

- Which model version produced this decision or output?
- Was the model registered with known metadata, metrics, and artifact hashes?
- Can the event history be checked for tampering?
- Can an external timestamped proof be produced without publishing private data?

Many teams already have model registries, application logs, and data platforms. Ernest focuses on the missing provenance layer between those systems and audit evidence.

## Proposed Approach

Ernest records hashes and metadata in an append-only local hashchain. It can then compute a Merkle root over the chain and optionally anchor that root to Sepolia through a Solidity contract.

Raw prompts, inference inputs, outputs, training datasets, and model binaries remain outside Ernest. Client systems hash those values and submit only evidence.

## Current Alpha Scope

- SvelteKit dashboard for demos and operational inspection.
- NestJS API for model registration, inference logging, chain verification, and anchoring.
- MongoDB-backed hashchain with duplicate-key retry handling.
- Optional Sepolia anchoring through `ErnestMerkleAnchor`.
- Go CLI for direct verification/query workflows.
- Docker Compose deployment for local demos or a small VPS.
- GHCR image publishing for repeatable container deployments.

## What This Proves

- A model or inference event can be represented as tamper-evident metadata.
- Chain integrity can be verified locally by recomputing block hashes.
- A public blockchain can hold a proof of existence without storing private AI data.
- The architecture can be deployed cheaply enough for demos and internal pilots.

## What It Does Not Yet Prove

- Enterprise authentication, authorization, or tenant isolation.
- Regulatory compliance by itself.
- That client-submitted hashes were computed honestly.
- High-throughput append behavior under production traffic.
- Production-grade custody of blockchain private keys.

## Incubation Fit

The project is a good incubator candidate if the goal is to evaluate AI auditability, evidence packaging, and provenance integration patterns before committing to a larger compliance platform.

Good pilot environments:

- Internal model-risk or governance demo.
- AI platform team proof-of-concept.
- Regulated-domain technical evaluation using synthetic data.
- Public demo showing hash-only provenance and external anchoring.

Poor pilot environments:

- Live regulated workloads without additional controls.
- Systems requiring RBAC, SSO, tenant isolation, or formal retention policies on day one.
- Workloads where raw sensitive data must be stored and governed inside the same tool.

## Recommended Next Milestones

1. Connect to an existing model registry or ML platform.
2. Add OIDC/JWT authentication and role-based authorization.
3. Add signed submissions from trusted client services.
4. Add write-attempt audit logs and rate limiting.
5. Validate backup/restore and disaster recovery for MongoDB.
6. Produce structured evidence exports for audit or GRC review.

Supporting material:

- `docs/demo-script.md` for a short stakeholder demo.
- `docs/maturity-model.md` for alpha-to-enterprise planning.
- `docs/threat-model.md` for security review.
