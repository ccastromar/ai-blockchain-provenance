# ADR-003: Data lifecycle — retention, legal hold and GDPR erasure

**Status:** Retention floor, legal hold and archive implemented; pruning and crypto-shredding
designed only
**Date:** 2026-10-04
**Related:** [threat-model.md](threat-model.md), [regulatory-mapping.md](regulatory-mapping.md).

## Context

Two obligations pull in opposite directions: the EU AI Act requires keeping automatically
generated logs for at least six months, and GDPR can require erasing personal data. Ernest is
an append-only hashchain, so deleting a block breaks every hash after it. "Delete a record"
has to mean something else. Ernest stores hashes and metadata only, so the personal-data
surface is small to begin with.

## Decision

1. **Retention floor.** Nothing younger than the configured minimum (default 180 days) is
   archived or pruned.
2. **Legal hold.** Global, per organization or per model; it blocks all archival and pruning.
   Setting and clearing a hold are recorded.
3. **Archive and prune to an anchor.** History past the floor, below a confirmed anchor and
   not on hold can go to a verifiable cold archive and then leave hot storage. The anchor and
   the archive still prove it existed.
4. **Erasure by crypto-shredding.** Fields that could hold personal data are stored encrypted
   under a per-subject key kept outside the chain. Destroying the key erases the plaintext,
   and every hash stays valid.

## Consequences

- A defensible answer to both "did you keep it?" and "can you erase it?", without weakening
  tamper evidence. Lifecycle actions are themselves evidence.
- After pruning, the archive's custody becomes part of the trust story.
- Crypto-shredding needs real key management, which belongs to the deployment.
- This ADR governs lawful lifecycle, not an operator who wipes everything; offsite anchors and
  backups expose that.
