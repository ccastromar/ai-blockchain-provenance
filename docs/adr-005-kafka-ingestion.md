# ADR-005: Kafka as the transport for high-volume evidence streams

**Status:** Accepted
**Date:** 2026-10-13
**Related:** [ADR-004](adr-004-merkle-batched-evidence.md) (Merkle-batched evidence, deployment
roles), [event-ingestion-layer.md](event-ingestion-layer.md), Prudence
`docs/operations/loadtest-results.md`.

## Context

ADR-004 listed Kafka under *Alternatives considered* and set it aside: a broker "smooths bursts,
which Redis Streams already does; it does not lift the chain's append ceiling". Both statements
were true when the chain was the limit. They no longer decide anything:

- With batching and the bulk write path, the chainer sustains ~11,000–13,000 events/s and the
  ingestor worker records ~9,000 events/s per process. The chain is not the bottleneck.
- The bottleneck moved to the **transport** between emitters and Ernest. Prudence's PDP — the
  highest-volume emitter — reached ~2,300 events/s through the ingestor because it sends one
  event per HTTP request. Fixing that over HTTP means a custom batch endpoint, pipelining and a
  custom retrying sender: re-implementing what a Kafka producer already does (batching,
  compression, idempotent retries, back-pressure).
- The organisations this targets run Kafka already. Producing to a topic needs no new endpoint,
  credential or client library on the emitter side, and gives what an evidence pipeline wants
  from its transport: durable, replicated, ordered per key, replayable, observable.

## Decision

High-volume, fire-and-forget evidence streams reach Ernest **through Kafka topics**. The
event-ingestor gains a Kafka source; HTTP remains for everything that needs a synchronous answer.

```
Prudence PDP ──► outbox ──► Kafka producer ──► topic prudence.decisions ─┐
other emitters ───────────────────────────────► topic … ─────────────────┤
                                                                          ▼
                      event-ingestor `kafka` (consumer group) ──► evidence_events (bulk insert)
                                                                          │
                                                       chainer (ADR-004) ─┘──► one block per batch
provider webhooks ──► event-ingestor HTTP ──► Redis Streams ──► worker ──► evidence_events
sealed / low-volume writes (reviews, attestations, incidents) ──► Ernest writer (HTTP)
```

### Record contract

One Kafka record per event, the same event the HTTP `POST /events` carries:

| Kafka | `POST /events` equivalent |
|---|---|
| header `source` | `X-Ernest-Event-Source` |
| header `eventType` | `X-Ernest-Event-Type` |
| header `sourceEventId` | `X-Ernest-Source-Event-Id` (falls back to the record key) |
| value (JSON object) | request body; `rawEventHash` = SHA-256 of the value bytes |
| key | partitioning only (Prudence uses the AI system id: per-system order) |

Events are stored exactly as the HTTP path stores them (`ingested_events`, `evidence_events`,
the model record) and deduplicated the same way, by `(source, sourceEventId, eventType)`. Their
`verificationStatus` is `kafka_acl` when Ernest connects with SASL — the cluster authenticates its
clients, and the topic's write ACL decides who may emit, as the shared key does for HTTP. Over a
connection without client authentication (PLAINTEXT, SSL without SASL) events are recorded
`unverified`, exactly like HTTP events when no ingestor key is configured.

### Security

Production runs `SASL_SSL` (SCRAM-SHA-512 by default; SCRAM-SHA-256 and PLAIN supported),
optionally with a private CA. Each side gets its own principal and only the ACLs it needs:

| Principal | ACLs |
|---|---|
| Prudence (producer) | `Write`, `Describe` on topic `prudence.decisions` |
| Ernest (consumer) | `Read`, `Describe` on the topic; `Read` on group `ernest-ingestor` |

Prudence refuses to start outside dev/test with `decision-transport=kafka` over anything but
`SASL_SSL` or `SSL`. A producer the broker rejects (bad credentials, no ACL) is a configuration
failure: decisions stay queued in Prudence's outbox, one error and one alert are raised, nothing
is dead-lettered. Verified against a local SCRAM + ACL broker: the authorized pair delivers and
records `kafka_acl`; an authenticated principal without ACLs and a wrong password both stay
queued with a single configuration error.

### Delivery semantics

- **At-least-once, end to end.** The consumer commits a partition's offsets only after the
  records are durably recorded (or durably recorded as failures). A crash replays them; replays
  are duplicates and are discarded by the dedup key — the same contract the Redis path has.
- **Poison records** (invalid JSON, a non-portable number) are written to `event_failures` and
  committed past, never retried forever and never silently dropped.
- **Infrastructure failures** (MongoDB down) are not committed: the consumer backs off and the
  records are redelivered.
- Prudence's outbox stays the source of truth on the producer side: a record is marked
  delivered when the broker acknowledges it (`acks=all`, idempotent producer).

### Scaling

Consumers in one group share a topic's partitions: run as many `event-ingestor kafka` processes
as partitions to scale recording horizontally (each inserts events; the single chainer of
ADR-004 still chains them). Partition count is the ceiling on parallelism — 8 by default for
`prudence.decisions`.

## Consequences

**Positive**

- No custom transport code for high volume: batching, compression, retries and back-pressure
  come from the Kafka client; emitters use a standard library.
- Durable, replicated, replayable stream of governance decisions before they reach the chain —
  an independent record auditors and other consumers (SIEM, data platform) can read.
- Recording scales by adding consumers up to the partition count.

**Negative**

- Kafka is one more system to operate where it is not already present. Redis Streams stays for
  provider webhooks, so the two coexist.
- Ordering is per partition, not global. ADR-004 already chains in admission order, and no
  consumer needs global order (ADR-004 open question 3).
- Qualified seals per event (ADR-002 B2) still require the direct HTTP path: a Kafka record is
  stored inside the ingestor's envelope, as with Redis.

## Not doing

- Replacing the HTTP API: reviews, attestations, incidents and every read stay HTTP.
- Kafka Connect / Debezium for Prudence's outbox. Prudence's outbox worker already guarantees
  durability before publishing; CDC would add a second moving part for the same guarantee.
  Reconsider if more emitters adopt the transactional-outbox pattern.
- Exactly-once (transactions). Dedup by event id gives the same observable result at lower cost.
