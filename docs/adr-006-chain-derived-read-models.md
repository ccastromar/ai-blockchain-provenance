# ADR-006: Read models derived from the chain

**Status:** Accepted
**Date:** 2026-10-13
**Related:** [ADR-004](adr-004-merkle-batched-evidence.md), [ADR-005](adr-005-kafka-ingestion.md).

## Context

Readers answered from the write model, so every count and integrity check re-read or re-hashed
stored blocks, and read cost grew with the chain. A Bitcoin node solves the same problem:
blocks are the only truth, each is validated when it is connected, and indexes are derived
from them and can be rebuilt.

## Decision

Ernest follows that model.

1. **Validate on connect.** An indexer takes blocks in order and validates each one as full
   verification would (contiguity, hash, link and batch root). It stops at an invalid block and
   reports it.
2. **Derive read models from validated blocks only**: per-model and per-system counts, each
   row remembering the last block applied, so a replay never counts a block twice.
3. **Continuous checkpoint**, so incremental verification starts near the tip.
4. **Reads use the indexes** and report how far they are indexed. Integrity can still be
   recomputed in full on request.
5. **Rebuildable** from block 0.

The indexes are a cache, not evidence. Auditors verify against blocks, proofs and anchors.

## Consequences

- Read cost no longer depends on chain length, and readers scale without re-hashing the chain.
- Counts include an event once its batch is chained, not while it is pending.
- Indexed integrity means "validated when connected", not "re-verified now", and the response
  says which.
