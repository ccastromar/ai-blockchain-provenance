# ADR-003: Data Lifecycle — Retention, Legal Hold, and GDPR Erasure

**Status:** Proposed
**Date:** 2026-10-04
**Deciders:** project maintainers
**Related:** [threat-model.md](threat-model.md) (N4, G1), [regulatory-mapping.md](regulatory-mapping.md)
(AI Act Art. 19/26, GDPR note), [backup-recovery.md](backup-recovery.md).

## Context

Two obligations pull in opposite directions, and Ernest currently has **no mechanism for
either** — it is a documented known gap (regulatory-mapping, "Retention policy, legal hold,
deletion workflows").

- **Keep the records.** EU AI Act Art. 19/26 requires providers/deployers to keep the
  automatically generated logs for **at least six months**. ISO 42001 and sectoral law can
  require longer.
- **Be able to erase.** GDPR Art. 17 (right to erasure) can require removing personal data
  on request.

The hard part is the architecture itself: Ernest is an **append-only, tamper-evident
hashchain**. Deleting or editing a block breaks every subsequent hash (threat-model G1), and
"delete the database and re-seed" is detectable by anyone who checks the published anchors
(threat-model N4). So *"delete a record"* cannot mean *"remove a block"*. It has to be
reframed.

Two facts make the reframing tractable:

- Ernest stores **hashes and metadata only** — by design it holds no prompts, inputs,
  outputs or datasets. The personal-data surface is small to begin with.
- The chain already produces **verifiable exports** (streaming `GET /api/blocks/export`) and
  **anchored roots**, so history that leaves hot storage can still be proven to have existed.

## Decision

Four mechanisms, each opt-in and each itself auditable.

### 1. Retention policy (a floor, enforced)

Config `RETENTION_MIN_DAYS` (default **180** ≥ the 6-month minimum). Nothing may be archived
or pruned while it is younger than this. The policy is documented and surfaced in `/health`
so an auditor can see it.

### 2. Legal hold (blocks everything)

A `legalHold` flag — global, and per-organization/model — that **blocks all archival and
pruning regardless of age**. Setting/clearing a hold is a privileged action and is itself
recorded as an event, so "we preserved this under hold" is provable. A standing rule or
investigation sets it; nothing ages out underneath it.

### 3. Archival + prune-to-anchor (how history leaves hot storage)

History older than `RETENTION_MIN_DAYS`, **below a confirmed anchor**, and **not under legal
hold** may be:

1. exported to a verifiable **cold archive** (the existing export bundle, whose integrity
   verifies at restore time), then
2. optionally pruned from hot storage, advancing a **prune watermark**.

Invariants: never prune at or above the latest confirmed anchor; the covering anchor + the
archive still prove the pruned history existed (so tamper-evidence survives); the prune
watermark is recorded so verification knows where hot history begins. This is retention
*management*, not erasure — the evidence is preserved, just moved.

### 4. GDPR erasure via crypto-shredding (not block deletion)

For any metadata field that could carry personal data, Ernest stores it **encrypted under a
per-subject key held outside the chain**; the block commits to the ciphertext (and its
hash), never the plaintext. **Erasure = destroy the key** — the ciphertext stays, the
plaintext becomes unrecoverable, and every hash and signature in the chain remains valid and
verifiable. This is the standard reconciliation of immutable ledgers with the right to
erasure.

Caveats, stated plainly: a *hash of personal data can itself be personal data*, so
personal-data fields must be salted/peppered or encrypted, never stored as a bare hash;
key management (a KMS/HSM) is out of scope for this ADR and is the deployment's
responsibility; and crypto-shredding erases the *plaintext*, not the fact that an event
occurred (which is the whole point of the evidence layer).

## Consequences

**Positive**
- A defensible answer to both "did you keep it?" (retention floor + verifiable archive) and
  "can you erase personal data?" (crypto-shred the key) without weakening tamper-evidence.
- Lifecycle actions (hold, prune, shred) are themselves events → the data lifecycle is
  provable, not just asserted.

**Negative / honest gaps**
- After pruning, a full re-scan can no longer re-derive pruned history from hot storage; you
  rely on the cold archive + the anchor. The archive's custody becomes part of the trust
  story.
- Crypto-shredding needs real key management; without a KMS it is only as good as where the
  keys live.
- **Deletion resistance (N4) is deliberately not solved here.** Nothing stops an operator
  from wiping everything; the mitigation remains offsite anchors + backups that expose the
  wipe to anyone who checks. This ADR governs *lawful* lifecycle, not an adversarial operator.

## Not doing
- Hard-deleting or editing blocks in place (breaks G1; the whole point is that you can't).
- Being a KMS/HSM — Ernest consumes keys, it does not manage their lifecycle.
- Resisting a malicious full wipe (that is the anchor/backup story, not retention).

## Companion: pilot security review

The other half of this step is **not code**: a security review with a real counterparty
(alpha-exit criterion). Deliverable to prepare for it: a pilot security-review checklist
(threat-model walkthrough, key-custody, retention/erasure story above, access model
OIDC/tokens, anchor custody, backup/restore drill). Tracked in `ROADMAP.md`.
