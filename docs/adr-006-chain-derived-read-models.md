# ADR-006: Read models derived from the chain (indexes)

**Status:** Accepted
**Date:** 2026-10-13
**Related:** [ADR-004](adr-004-merkle-batched-evidence.md) (batching, deployment roles),
[ADR-005](adr-005-kafka-ingestion.md) (Kafka ingestion).

## Context

ADR-004 split a deployment into `writer`, `chainer` and `reader` processes, but the `reader`
still answers from the write model: every query aggregates or re-hashes the stored blocks and
events. Read cost therefore grows with the chain. Measured after a load test (one model with
~600k events): per-model integrity ~5 s, a first incremental `verify` after heavy writes 9–16 s,
per-model and per-system counts as collection-wide aggregations.

A Bitcoin node solves the same problem without weakening what is true. Blocks on disk are the
only source of truth. Each block is **validated when it is connected**, and **indexes**
(`txindex`, `blockfilterindex`, `coinstatsindex`) are derived from blocks in the background,
each remembering the block it is synced to and rebuildable from the chain (`-reindex`). RPC
reads the indexes.

## Decision

Ernest follows that model.

1. **Validate on connect.** An indexer runs with the `chainer` role. It takes blocks in index
   order from where it stopped and validates each one exactly as `GET /api/verify` would: index
   contiguity, the block hash, the link to the previous block and, for a batch block, the
   Merkle root re-derived from the stored events' data. A block that fails stops the indexer
   there (the tip does not advance past an invalid block) and the failure is reported.
2. **Derive read models from validated blocks only.** Per model: evidence count, first and last
   block. Per AI system: execution count (`metadata.stage = execution`). Each row records the
   last block applied to it, and an update applies only to a row behind that block, so a crash,
   a replay or two indexers at once never count a block twice.
3. **Continuous checkpoint.** The indexer persists its validated tip as the integrity
   checkpoint, so incremental verification starts at most a few seconds behind the tip.
4. **Reads use the indexes.** `GET /api/stats/models` and `GET /api/stats/executions` answer
   from the read models and report `indexedUpTo`. `GET /api/models/{id}/integrity` answers in
   `mode=indexed` by default (every block holding the model's evidence was validated when it
   was connected) and keeps `?mode=full` to recompute every hash and root now.
5. **Rebuildable.** Dropping the index collections makes the indexer rebuild them from block 0.

### What the indexes are not

The indexes are a cache of facts about the chain, not evidence. Auditors and third parties
verify against blocks, event proofs and anchors (`?mode=full`, `GET /api/verify?mode=full`, the
CLI and WASM verifiers), never against an index. A tamper after a block was validated is caught
the way it is today: the anchor-root check on every scheduled run and the daily full scan.

## Consequences

**Positive**
- Read cost for counts and per-model integrity no longer depends on chain length.
- Incremental verification is always near the tip.
- Readers can scale without each one re-hashing the chain.

**Negative**
- Counts cover chained evidence: an event is visible in the indexes once its batch is chained
  (≤ one batch interval plus one indexer pass), not while pending.
- One more component in the chainer; when it stalls (invalid block, store down) the indexes
  lag and report the tip they reached.
- `mode=indexed` integrity is "validated when connected", not "re-verified now"; the response
  says which.
