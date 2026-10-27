# ADR-002: Enterprise identity (OIDC) and qualified trust services

**Status:** Decision A and B1 implemented; B2 implemented up to the QTSP integration
**Date:** 2026-09-30
**Related:** [ADR-001](adr-001-signed-submissions.md), [regulatory-mapping.md](regulatory-mapping.md).

## Context

Two questions are often confused, and this ADR keeps them apart:

1. **Who is calling Ernest?** Shared keys and tokens say "someone with the write key", not
   which person or service.
2. **Does the evidence carry legal weight in the EU?** Ed25519 signatures and OTS/EVM anchors
   are cryptographically sound, but they are not qualified eIDAS trust services, so they carry
   no legal presumption.

OIDC answers the first; qualified trust services answer the second. Neither may break offline
verification or air-gapped operation.

## Decision A — OIDC for caller identity

- **A1–A3.** Bearer JWTs validated against the issuer's keys (signature, issuer, audience,
  expiry), with claims mapped to Ernest's roles. Opt-in and additive: static keys and tokens
  keep working for CI, scripts and air-gapped use. The console signs in with authorization code
  and PKCE.
- **A4.** A write records the authenticated subject (who submitted), separate from the ADR-001
  signature (who signed the payload).
- **A5 (deferred).** Binding emitter keys to an OIDC subject at enrollment.

## Decision B — Qualified trust services

Both are additive and fail soft: a QTSP outage never blocks anchoring or writes.

- **B1. Qualified timestamp.** An RFC 3161 timestamp over each anchored Merkle root, stored
  next to the anchor and verifiable offline against the TSA's certificate chain.
- **B2. Qualified electronic seal.** An additional envelope type: the same signed bytes as
  ADR-001, sealed with a QTSP-issued certificate (remote sealing through the CSC API) and
  verified offline against a trust anchor. Ed25519 stays the default.

## Consequences

- Per-person audit identity and enterprise SSO, without losing the key path.
- Qualified services move evidence from "cryptographically verifiable" to "legally presumed
  under eIDAS", with OTS and Ed25519 as the always-on floor.
- A QTSP is a contract, not just code. Offline verification of qualified artifacts needs a
  dated snapshot of the EU trusted lists.
- OIDC is not a qualified identity; EUDI Wallet is out of scope.
