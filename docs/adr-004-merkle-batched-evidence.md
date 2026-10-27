# ADR-004: Merkle-batched evidence (one block per batch, not per event)

**Status:** Implemented behind `EVIDENCE_BATCHING` (`off`, `events`, `on`). The default is
`events`: the idempotent event store, still one block per event. The open questions below gate
the default moving to `on`.
**Date:** 2026-10-13
**Related:** [ADR-001](adr-001-signed-submissions.md), [ADR-002](adr-002-oidc-and-qtsp.md),
[ADR-003](adr-003-data-lifecycle.md), [ADR-005](adr-005-kafka-ingestion.md).

## Context

With one block per event, every append needs the previous block's hash, so writes are
serialized across the deployment and every chain-wide operation (verification, anchoring,
archive, audit bundles) grows with the number of events. Agent platforms produce a decision
and an execution record per governed tool call: millions of events a day.

## Decision

Separate **storing** an event from **chaining** it. Events are stored individually and
deduplicated; the chain records one block per batch, committing to its events through a Merkle
root. Every event stays individually provable.

1. **Event store.** One record per event, unique by source and event id. A resent event returns
   the existing record. Admission checks (ADR-001 signatures, ADR-002 B2 seals) run before the
   insert.
2. **Batcher.** One active batcher per chain, elected through a lease. On a time or size
   threshold it builds an RFC 6962 tree over the pending events and appends one batch block.
   It is idempotent, so a crash is resumed by the next leader.
3. **Proofs.** An event's proof is its data, its audit path, the batch root and the block, plus
   the anchor receipt when there is one. It verifies offline in the CLI and the browser,
   pinned by golden vectors.
4. **Reads** come from the event store.
5. **Submissions** answer "accepted, pending"; a duplicate answers with the existing record.
6. **Qualified services.** Per-event seals (ADR-002 B2) are unchanged. The qualified timestamp
   (B1) can cover each batch or each anchor.
7. **Rollout** in steps, each switchable. Existing per-event blocks stay valid forever.

Deployments can split by role: readers, writers and a single chainer.

## Consequences

- Write capacity becomes the database's insert rate; chain-wide work grows with batches, not
  events. Idempotent submission comes for free.
- An event is pending for up to one batch interval.
- Two Merkle constructions coexist: RFC 6962 for batches, and the existing one for anchors.

## Open questions

1. eIDAS: does a sealed batch manifest plus an inclusion proof equal a per-event seal?
2. Batch interval and size defaults, to confirm under load.
3. Whether per-model order is enough for every consumer.
