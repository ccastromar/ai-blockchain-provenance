# ADR-005: Kafka as the transport for high-volume evidence

**Status:** Accepted
**Date:** 2026-10-13
**Related:** [ADR-004](adr-004-merkle-batched-evidence.md), [event-ingestion-layer.md](event-ingestion-layer.md).

## Context

Once evidence was batched (ADR-004), the chain stopped being the bottleneck; the transport
between emitters and Ernest became it. Sending one event per HTTP request caps high-volume
emitters such as Prudence's decision point. Doing better over HTTP would mean re-implementing
what a Kafka producer already does: batching, compression, idempotent retries and
back-pressure. The organizations this targets usually run Kafka already.

## Decision

High-volume, fire-and-forget evidence reaches Ernest **through Kafka topics**, read by the
event-ingestor as a consumer group. HTTP stays for everything that needs a synchronous answer
(reviews, attestations, incidents and all reads).

- **Records** carry the same event as the HTTP ingestion endpoint (source, type and event id in
  headers, the event as the value) and are deduplicated the same way.
- **Security.** Production uses SASL over TLS, with one principal per side and only the ACLs it
  needs. Events from an authenticated connection are recorded as such; the others are
  recorded as unverified.
- **Delivery is at least once.** Offsets are committed only after the records are stored;
  replays are discarded as duplicates. Malformed records are stored as failures and skipped.
  If storage is down, nothing is committed and the records are redelivered.
- **Scaling.** Add consumers, up to the number of partitions.

## Consequences

- No custom transport code for high volume, and a durable, replayable stream that other
  consumers (a SIEM or a data platform) can read too.
- Kafka is one more system to run where it is not already there.
- Order is per partition, which is enough for every current consumer.

## Not doing

- Replacing the HTTP API.
- Exactly-once transactions: deduplication by event id gives the same result.
