# ADR-002: Enterprise Identity (OIDC) and Qualified Trust Services (QTSP)

**Status:** Decision A (OIDC) implemented 2026-09-30; Decision B (QTSP) proposed
**Date:** 2026-09-30
**Deciders:** project maintainers
**Related:** [ADR-001](adr-001-signed-submissions.md) (per-emitter Ed25519 signing),
[regulatory-mapping.md](regulatory-mapping.md) (eIDAS section), `ROADMAP.md`.

## Context

Two identity/trust questions are still unanswered in Ernest, and they are commonly
conflated. This ADR separates them on purpose:

1. **Who is calling Ernest?** Today request auth is a shared API key, a read-only key, or
   a Mongo-backed named token ([access-role.util.ts](../backend/src/auth/access-role.util.ts)).
   There is no per-person enterprise identity — an audit trail cannot say *which human or
   service principal* performed a write, only that "someone with the write key did".
2. **Does the evidence carry legal weight in the EU?** ADR-001 gives cryptographically
   sound authorship (self-managed Ed25519) and the anchoring gives a cryptographically
   sound timestamp (OTS/Bitcoin, EVM). Neither is a **qualified** eIDAS trust service, so
   neither carries the automatic **legal presumption** that qualified services do.

These map to two independent integrations:

- **OIDC** answers (1) — *authentication identity* of the caller.
- **QTSP** answers (2) — *qualified trust services*: a qualified electronic timestamp for
  anchoring, and a qualified electronic seal for emitter signatures.

They are orthogonal. OIDC does not make evidence qualified; QTSP does not tell you who
clicked the button. A mature deployment wants both. Neither may break the two properties
that define Ernest: **offline verification** (receipts verify with no live service) and
**air-gapped operability** (the core runs with no external dependency).

---

## Decision A — OIDC for caller identity

Add OpenID Connect as an **additive** third resolution path in request auth, alongside
the existing static keys and Mongo tokens. Opt-in via env; absent config, nothing changes.

> **Implemented** (A1–A4): `OidcService` ([backend/src/auth/oidc.service.ts](../backend/src/auth/oidc.service.ts))
> validates bearer JWTs via `jose` (discovery + cached JWKS), maps claims to `ErnestRole`,
> and is wired into `resolveAccess` and both guards; `whoami` reports the OIDC identity;
> guards attach the resolved identity to the request (`request.ernestAccess`) for A4.
> The SvelteKit frontend does Authorization Code + PKCE SSO
> ([frontend-svelte/src/lib/oidc.ts](../frontend-svelte/src/lib/oidc.ts) + `/auth/callback`),
> sends the token as `Authorization: Bearer`, and keeps the paste-a-key path as the
> air-gap/demo fallback. A5 (binding emitter keys to an OIDC subject) remains
> optional/deferred.

### A1. Token validation

A caller presents `Authorization: Bearer <JWT>`. A new `OidcService`:

- Discovers the IdP via `${OIDC_ISSUER}/.well-known/openid-configuration` (or explicit
  `OIDC_JWKS_URI`), fetching and caching the JWKS (respect `Cache-Control`, refresh on
  unknown `kid`).
- Verifies the JWT signature (RS256/ES256), and validates `iss`, `aud` (`OIDC_AUDIENCE`),
  `exp`, `nbf`, `iat` with a small clock-skew allowance. (Reuse the NTP drift work's
  clock discipline — a server with drift would misvalidate tokens.)
- Returns the principal: `sub`, `email`/`preferred_username`, and the role claim.

### A2. Claims → role mapping

Reuse the existing `ErnestRole` (`read-write | read-only | anonymous`). Config:

```
OIDC_ISSUER            e.g. https://login.microsoftonline.com/<tenant>/v2.0
OIDC_AUDIENCE          the API's client id / resource identifier
OIDC_ROLE_CLAIM        claim to read for role/groups (default: "roles")
OIDC_ROLE_MAP          "ernest-writers=read-write,ernest-auditors=read-only"
```

### A3. Wiring (minimal, by design)

`resolveAccess()` gains one branch **before** the API-key branches, so an enterprise
deployment prefers verified identity but keys still work for CI, scripts and air-gap:

```ts
// access-role.util.ts (sketch)
export async function resolveAccess(req, tokenService, oidcService): Promise<ResolvedAccess> {
  const bearer = readBearer(req.headers.authorization);
  if (bearer && oidcService?.enabled) {
    const principal = await oidcService.verify(bearer);   // throws → fall through to keys
    if (principal) return { role: principal.role, label: principal.email, subject: principal.sub };
  }
  // ...existing static-key and Mongo-token resolution unchanged...
}
```

`ApiKeyGuard` / `ReadAccessGuard` already funnel through `resolveAccess`, so the guards
barely change. `ResolvedAccess` gains an optional `subject`.

### A4. Audit binding

When a write resolves via OIDC, record `subject`/`email` on the action (request-level
provenance: *who submitted*), distinct from the **event-level** authorship that ADR-001's
Ed25519 signature provides (*who signed the payload*). Both can be present and mean
different things — keep them separate in the data model and in the UI.

### A5. Optional — bind emitter keys to an OIDC identity

Extend `EmitterKey` with `ownerSubject?` and require an OIDC-authenticated principal to
register/revoke a key. This binds `keyId ↔ verified identity` at enrollment — a
lightweight step toward keyless (sigstore) signing without adopting Rekor yet, and it
closes the "who registered this key?" gap. Enrollment binding is online; **verification
stays offline** (the envelope still embeds the public key).

---

## Decision B — QTSP for qualified trust services

Make Ernest able to *incorporate* qualified trust services without ceasing to be Ernest.
Both integrations below are **additive**: a QTSP outage or contract lapse must never block
anchoring or writes — OTS/Bitcoin and self-managed Ed25519 keep running underneath.

### B1. Qualified electronic timestamp (anchoring)

Add a provider to the existing anchor dispatch (`ANCHOR_PROVIDER = ots | evm`), but as an
**additional** stamp rather than an alternative:

- Per anchor batch Ernest already computes a Merkle **root hash**. Besides OTS/EVM, POST
  that hash to a QTSP's **RFC 3161** TSA and receive a signed **TimeStampToken** (TST,
  CMS/PKCS#7). Store the `.tsr` next to the anchor, exposed like the `.ots` proof
  (`GET /api/anchors/:id/tst`).
- **Offline verifiable** against the QTSP's certificate chain, rooted in an EU Trusted
  List CA — the same offline ethos as the OTS proof, now with legal presumption.

```
ANCHOR_QTS_ENABLED     true|false (additive; independent of ANCHOR_PROVIDER)
QTS_TSA_URL            the QTSP's RFC 3161 endpoint
QTS_TSA_HASH_ALG       sha256
QTS_TSA_CREDENTIAL     optional (some TSAs authenticate requests)
```

Details: send a random **nonce** (replay protection), request the signing cert in the
response (`certReq=true`), record the TSA `accuracy`, and fail **soft** — log and alert
`WEBHOOK_URL` (`qts.timestamp.failed`) but let the batch anchor via OTS/EVM regardless.

### B2. Qualified electronic seal (emitter signatures)

Add a **qualified seal** envelope as an *additional* signature type, exactly as ADR-001
deferred sigstore to "an additional envelope type". Self-managed Ed25519 stays the default
and the air-gap path.

- A qualified electronic seal is produced with a **QTSP-issued certificate for a legal
  person**. The realistic server integration is **remote sealing**: the QTSP holds the
  QSCD (qualified seal creation device); Ernest calls their **remote signing API**
  (the **Cloud Signature Consortium (CSC) API** is the interop standard) to seal the same
  `signedBytes` ADR-001 already defines — `PAE("application/vnd.ernest.provenance+json",
  C(payload))`. **The bytes being signed do not change**, only who/what signs them.
- Envelope keeps the DSSE shape; the difference is the algorithm and the key material:

```json
"signature": {
  "alg": "qeseal-ecdsa-p256",
  "keyId": "…",
  "x5c": ["<base64 DER cert>", "<intermediate>"],
  "signedAt": "…",
  "sig": "<base64>"
}
```

- Verification walks `x5c` to a trust anchor on the **EU List of Trusted Lists (LOTL)**
  and checks the signature. To keep verification offline, Ernest bundles and periodically
  refreshes a **trusted-list snapshot** (see gaps).
- Schema: `EmitterKey` gains `certificate`/`x5c` and `algorithm` enum extends; or a
  parallel `sealed_emitters` collection. `SEAL_LEVEL = self | qualified` selects the
  required level under `SIGNED_SUBMISSIONS=required`.

---

## Consequences

**Positive**

- OIDC gives per-principal audit identity and enterprise SSO without discarding the
  key/token path (CI, air-gap, offline all keep working).
- The qualified timestamp + seal move evidence from *"cryptographically verifiable"* to
  *"legally presumed under eIDAS"* — the decisive line for EU regulated buyers — while the
  free keyless OTS/Bitcoin anchor and self-managed Ed25519 remain as the always-on floor.
- Both integrations preserve offline verification (TST and seal both verify against
  certificate chains, given a trusted-list snapshot).

**Negative / honest gaps**

- **QTSP is a contract, not just code.** You need an actual QTSP on an EU Trusted List,
  test credentials, and budget (per-timestamp and per-seal pricing). Sandbox/test QTSPs
  and CSC test endpoints exist for a PoC, but "qualified" requires the real contract.
- **Trusted-list dependency.** Offline verification of *qualified* artifacts needs a LOTL
  snapshot bundled and refreshed. That is new state and a freshness policy Ernest does not
  have today — a genuine tension with the air-gap goal (mitigation: ship a dated snapshot,
  verify "valid as of <snapshot date>").
- **Availability coupling.** Remote sealing and RFC 3161 add network calls. Kept additive
  and fail-soft so they never gate the core, but a *required* qualified level does couple
  writes to a third party — a deployment choice, documented, not a default.
- **OIDC ≠ qualified identity.** OIDC authenticates a caller against an IdP; it is not an
  eIDAS qualified identity. The natural next axis — natural-person identity via the **EUDI
  Wallet / verifiable credentials** — is deliberately **out of scope** here and left to a
  future ADR.
- None of this changes the cryptographic guarantee, which is already strong; it adds
  *legal* weight and *enterprise* identity on top.

## Rollout (suggested order, each shippable alone)

1. **OIDC verification + role mapping** (A1–A3) — pure code, no third party, highest
   near-term value for a pilot with an enterprise IdP.
2. **Audit binding + optional emitter-key ownership** (A4–A5).
3. **Qualified timestamp** (B1) against a QTSP sandbox TSA — additive, low blast radius.
4. **Qualified seal** (B2) via a CSC sandbox — the heaviest lift; do it last, when a pilot
   actually asks for legal presumption on authorship.

## Not doing (for now)

- EUDI Wallet / verifiable-credential presentation (future ADR).
- Local smartcard/HSM sealing (remote sealing via CSC is the server-appropriate path).
- Making qualified services mandatory by default (stays opt-in; the keyless/self-managed
  floor is the default so air-gapped and free-tier deployments are unaffected).
