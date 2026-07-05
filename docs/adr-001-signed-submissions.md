# ADR-001: Signed Provenance Submissions (v1 — per-emitter Ed25519)

**Status:** Proposed
**Date:** 2026-07-05
**Deciders:** Carlos (project owner)

## Context

Ernest's threat model is explicit about N2: *"Ernest proves an event was recorded and
not altered since. It cannot prove the event was true."* Today it also cannot prove
**who** submitted it — any holder of the shared write credential produces
indistinguishable events. For the audit story ("which system claimed this accuracy
metric?") authorship matters as much as integrity.

Forces at play:

- The platforms Ernest integrates with authenticate *requests* (bearer tokens, IAM
  SigV4, webhook HMAC) but do not sign *events*; nothing upstream gives us
  non-repudiation for free.
- The industry's signature convergence is sigstore (ECDSA + OIDC keyless + Rekor) and
  DSSE/in-toto envelopes; Ed25519 is the standard choice for self-managed keys.
- Ernest already has two assets that make signing cheap and deterministic: the
  RFC 8785 canonicalization pinned by cross-language golden fixtures, and a
  registry-with-revocation UX (access tokens) worth mirroring.
- Receipts are verified offline (CLI, browser WASM); a signature scheme that needs a
  live registry lookup at verification time would break that property.

## Decision

Add optional, per-emitter **Ed25519 signatures over the canonical submission payload**,
carried in a **DSSE-compatible envelope**, verified at admission time against a
**registered-key directory**, and stored **inside the block** so every downstream
verifier (receipt, CLI, WASM, export) can check authorship offline forever.

### 1. Key registry (admission control only)

New collection `emitter_keys`, managed like access tokens:

```
POST   /api/auth/emitters   { label, publicKey (base64, 32 bytes), expiresInDays? }   [write credential]
GET    /api/auth/emitters                                                              [write credential]
DELETE /api/auth/emitters/:keyId                                                       [write credential]
```

- `keyId` = first 16 hex chars of SHA-256(raw public key) — deterministic, printable.
- Fields: label, publicKey, algorithm (`ed25519`), createdAt, expiresAt?, revokedAt?,
  lastUsedAt.
- Rotation = register new key, revoke old. Revocation affects **future admissions
  only** — see §4 for why history stays valid.

### 2. What exactly is signed

`signedBytes = PAE("application/vnd.ernest.provenance+json", C(payload))` where:

- `C` is Ernest's canonicalization (RFC 8785 profile, excluded keys, ES numbers) — the
  exact law already pinned by `testdata/hash-golden-vectors.json`. **Signatures and
  block hashes share one canonical form**; no second serialization to keep honest.
- `payload` is the submission's `data` content as the client knows it (for
  `model_registration`: the DTO fields; for `inference`: idem), **excluding the
  `signature` field itself**.
- PAE is DSSE's Pre-Authentication Encoding — adopted verbatim for interop credibility
  with the in-toto/sigstore ecosystem.

The envelope travels as an optional `signature` field on the write DTOs and is stored
inside `block.data`:

```json
"signature": {
  "alg": "ed25519",
  "keyId": "9f3ab2…",
  "publicKey": "<base64 raw 32B>",
  "signedAt": "2026-07-05T10:00:00Z",
  "sig": "<base64 64B>"
}
```

### 3. Enforcement modes

`SIGNED_SUBMISSIONS = off | optional | required` (default `optional`):

- `optional`: unsigned writes accepted as today; a present envelope is verified and
  rejected if invalid (a *bad* signature is never stored).
- `required`: unsigned writes rejected (`400 signature_required`); unknown, revoked or
  expired keys rejected (`401 unknown_key / key_revoked / key_expired`).
- Admission checks: signature verifies against `publicKey`, `keyId` matches the key,
  and the key is registered, unrevoked, unexpired **at write time**.

v1 scope is the **direct API write path** (`POST /api/models`, `POST /api/inferences`).
The ingestor pipeline is explicitly v1.1: adapters enrich/normalize provider payloads,
so the signed-subset contract there needs its own design; provider webhooks keep the
existing `verificationStatus` ladder (HMAC = authenticated channel, no non-repudiation).

### 4. Verification points — offline-first

The block carries `keyId`, `publicKey` and `sig`, so verification needs **no registry
and no server**:

| Verifier | Check added |
| --- | --- |
| Backend (admission) | Full check incl. registry state — the only place revocation applies |
| `ernest proof verify` (Go) | Strip `signature`, canonicalize (`hashcanon`), `crypto/ed25519.Verify` — prints `✓ signed by <keyId>` |
| `/verify-receipt` (WASM) | Same, via `ed25519-dalek` in `merkle-wasm` |
| Chain export / full verify | Signature travels inside hashed data — already tamper-evident; batch signature re-verification is a v1.1 option for the daily full scan |

Why history survives revocation: a signature made while the key was valid remains a
valid statement *by that key*; the chain position and the anchor bound **when** it was
made. Revocation is admission control, not retroactive disavowal — the same model as
X.509 + timestamping, and the reason the key material is embedded rather than looked up.

A new cross-language fixture, `testdata/signed-submission-golden.json` (fixed test
keypair, payload, canonical bytes, PAE bytes, signature), pins Node `crypto`,
Go `crypto/ed25519` and Rust `ed25519-dalek` to byte-identical verification — same
discipline as the hash and Merkle fixtures, because a signature disagreement between
verifiers is also a consensus fork.

### 5. Interactions with existing invariants

- **Hash law untouched**: `signature` is ordinary nested data inside `block.data`;
  golden hash vectors are unaffected (one vector containing an envelope will be added
  to prove neutrality).
- **Number normalization**: the writer's doubles-only rule means client-side canonical
  bytes and stored-data canonical bytes coincide for every accepted payload — signatures
  survive storage round-trips by construction.
- **Replay**: an identical signed submission replayed hits the existing duplicate
  guards (`(modelId, version)`); inference replay posture is unchanged from today and
  tracked separately. `signedAt` gives auditors a client-claimed time to cross-check.

## Options Considered

### Option A: Ed25519 + self-managed key registry (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low-medium — stdlib crypto in all four implementations; registry mirrors access tokens |
| Operational burden | Emitters generate a keypair once; no external services |
| Non-repudiation | Yes, per registered emitter |
| Offline verification | Yes — key embedded in block |

**Pros:** no new dependencies of consequence (Node/Go stdlib; one Rust crate); one
canonical form for hash and signature; works air-gapped; registry UX already familiar.
**Cons:** key distribution/custody is the emitter's problem; identity is "whoever
holds the key", not an organizational identity.

### Option B: sigstore keyless (OIDC + Fulcio + Rekor) now

**Pros:** identity bound to OIDC accounts, transparency log, industry direction.
**Cons:** requires reachable Fulcio/Rekor (or self-hosted — heavy) — breaks the
on-prem/air-gapped deployment story; large dependency surface; certificate validation
logic in four verifiers. **Deferred to v2 as an additional envelope type**, not a
replacement.

### Option C: mTLS client certificates

**Pros:** mature enterprise tooling. **Cons:** authenticates the *connection*, not the
*event* — nothing durable lands in the block, so receipts gain nothing; PKI operation
cost lands on every deployment. Rejected: solves transport identity, not evidence.

### Option D: per-client HMAC

**Pros:** trivial. **Cons:** shared secret ⇒ Ernest itself could forge "signed" events
⇒ no non-repudiation — the property this ADR exists to add. Rejected as the primary
mechanism; remains the channel-auth rung for provider webhooks.

## Consequences

- **Easier:** attributing evidence ("signed by the training pipeline's key"); the N2
  paragraph and the "client identity on writes" gap in the threat model both improve;
  receipts become *attributed* evidence — block → author, root → time.
- **Harder:** emitters must manage a private key; `required` mode adds an onboarding
  step per writing system; four verifiers to keep in lockstep (mitigated by the golden
  fixture).
- **Revisit later:** sigstore envelope type (v2); ingestor-path signing contract
  (v1.1); batch signature verification in the daily full scan; signer identity display
  (label lookup) in the dashboard.

## Action Items

1. [ ] `emitter_keys` schema + registry endpoints + tests (mirror access-token suite).
2. [ ] Envelope validation on write DTOs; admission verification + `SIGNED_SUBMISSIONS` modes; HTTP-matrix rows.
3. [ ] `testdata/signed-submission-golden.json` + generator script.
4. [ ] Go: signature step in `ernest proof verify`; Rust: `ed25519-dalek` in merkle-wasm + `/verify-receipt` display; golden tests in all.
5. [ ] Emitter helper: `ernest keygen` (or a documented `openssl`/Python one-liner) + signing example in `integrations/`.
6. [ ] Threat model (N2, gaps table, new scenario rows) + regulatory mapping ("who" column) + CHANGELOG.
