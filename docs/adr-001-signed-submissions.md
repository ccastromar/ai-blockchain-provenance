# ADR-001: Signed provenance submissions

**Status:** Accepted (implemented)
**Date:** 2026-07-05

## Context

Ernest proves that an event was recorded and not altered since. With a shared write
credential it cannot prove **who** submitted it, and for an audit, authorship matters as much
as integrity. Receipts are verified offline, so a signature must not need a live lookup to
verify.

## Decision

Optional per-emitter **Ed25519 signatures** over the canonical submission payload, in a
**DSSE-compatible envelope**, stored inside the block.

- **Key registry.** Emitters register public keys; rotation is register new, revoke old.
  Revocation applies to future submissions only: a signature made while the key was valid
  stays valid, and the chain and its anchor bound when it was made.
- **Signed bytes.** DSSE pre-authentication encoding over the same canonical form the block
  hash uses (RFC 8785 profile), so there is one canonical form to keep honest.
- **Modes:** off, optional (default; a bad signature is always rejected) or required.
- **Offline verification.** The block carries the key and the signature, so the backend, the
  CLI and the browser verifier check authorship with no server. A shared golden fixture keeps
  the implementations byte-identical.

## Options considered

- **Sigstore keyless.** Identity bound to OIDC and a transparency log, but it needs reachable
  external services, which breaks on-premises and air-gapped use. Deferred as an additional
  envelope type.
- **mTLS client certificates.** Authenticate the connection, not the event; nothing durable
  lands in the block. Rejected.
- **Per-client HMAC.** A shared secret means Ernest could forge signatures: no
  non-repudiation. Kept only as channel authentication for provider webhooks.

## Consequences

- Evidence becomes attributed: block to author, anchor to time.
- Emitters must keep a private key, and required mode adds an onboarding step.
- Later: a sigstore envelope type, and signing on the ingestor path.
