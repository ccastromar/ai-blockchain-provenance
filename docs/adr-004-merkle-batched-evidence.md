# ADR-004: Merkle-Batched Evidence (one block per batch, not per event)

**Status:** Proposed — all five rollout steps and the verifiers implemented behind
`EVIDENCE_BATCHING` (default `off`); see [Implementation status](#implementation-status). The
open questions below still gate switching it on in production.
**Date:** 2026-10-13
**Deciders:** project maintainers
**Related:** [ADR-001](adr-001-signed-submissions.md) (emitter signatures),
[ADR-002](adr-002-oidc-and-qtsp.md) (B1 qualified timestamp, B2 qualified seal),
[ADR-003](adr-003-data-lifecycle.md) (retention, prune-to-anchor, crypto-shredding),
[event-ingestion-layer.md](event-ingestion-layer.md), Prudence `docs/operations/loadtest-results.md`.

## Context

Ernest records **one hashchain block per event**. Every block needs the hash of the one before
it, so appends are serialized across the whole deployment: more replicas do not add write
capacity, they add append races.

A load test of Prudence + Ernest (one host, every component co-located; Prudence
`docs/operations/loadtest-results.md`) measured, after the phase-0 fixes (per-credential throttling,
missing `data.modelId` index, Redis connection pool, incremental verify):

| | Measured |
|---|---|
| Chain appends, batch endpoint | ~2,800 blocks/s |
| Chain appends, ingestor worker | ~1,300 blocks/s |
| Append races, 8 concurrent single writers | 12 % of writes answered 409 (retried) |
| Full `verify` at 318k blocks | 5.3 s, linear in chain length |

The demand side is set by agent platforms: every governed tool call produces a PDP decision and
an execution record. 1,000 agents calling a tool every 10 s is ~200 events/s sustained — about
**17 million blocks a day**. Per-event blocks make every chain-wide operation scale with
*events*: full verification, anchoring (the Merkle tree is rebuilt over all block hashes),
archive/prune (ADR-003), storage, and offline audit bundles. And an emitter that qualify-seals
each submission (ADR-002 B2) pays one QTSP round trip — and, with a commercial QTSP, one fee —
per event.

Phase 0 bought headroom on one host; it does not change the shape. This ADR changes the shape.

## Decision

Separate **storing an event** from **chaining it**. Events are stored individually and
deduplicated; the chain records **one block per batch**, committing to the batch's events
through a Merkle root. Every event stays individually provable.

```
submission ──► evidence_events  (insert; unique (source, eventId); admission checks as today)
                   │   every T seconds or N events, whichever first
                   ▼
   RFC 6962 Merkle tree over the batch's leaf hashes
                   │
                   ▼
   ONE block { type: "batch", root, size, firstSeq, lastSeq, treeAlg, previousHash }
                   │
                   └─► (optional) qualified timestamp over the block hash (ADR-002 B1)
```

### 1. Event store

New collection `evidence_events`, one document per accepted event:

- `seq` — monotonic sequence number (allocated from a counter document; defines batch order).
- `source`, `eventId` — **unique together**. A re-sent event with the same id returns the
  existing record instead of a new one. This is the idempotency Ernest lacks today (paused
  "Ernest idempotency" item): it falls out of the design rather than being bolted on.
- `modelId`, `type`, `data` — exactly the block `data` Ernest stores today (same shape, same
  `cleanObject`/JCS canonicalization), so per-event semantics and signatures are unchanged.
- `leafHash` — `SHA-256(0x00 || JCS(data))` (RFC 6962 leaf hashing, domain-separated).
- `batch` — `{ blockIndex, leafIndex }` once included; absent while pending.
- Indexes: `(source, eventId)` unique, `seq` unique, `(modelId, seq)`,
  `(data.metadata.stage, data.metadata.aiSystemId, seq)`, `batch.blockIndex`.

Admission is unchanged: ADR-001 signature checks, ADR-002 B2 qualified-seal verification and the
model-registration ordering rule run before the insert. The insert is an ordinary indexed write —
no "read the tip, write tip+1" race — so admission scales with MongoDB, not with the chain.

### 2. Batcher

A single batcher per chain (a lease document gives one active leader across replicas; a lost
lease is taken over after its TTL):

1. Every `BATCH_INTERVAL_MS` (default **1000**) or when `BATCH_MAX_EVENTS` (default **1000**,
   cap 10,000) are pending, take pending events in `seq` order.
2. Build an RFC 6962 tree: SHA-256, leaves as above, interior nodes
   `SHA-256(0x01 || left || right)`, no pair sorting. (Domain separation prevents a leaf being
   passed off as an interior node — the second-preimage weakness of plain sorted-pair trees.)
3. Append one block `{ type: "batch", root, size, firstSeq, lastSeq, treeAlg: "rfc6962-sha256" }`
   through the existing append path (unchanged hashing of the block itself).
4. Write `batch.{blockIndex, leafIndex}` onto the included events.

Steps 3–4 are idempotent per `(firstSeq, lastSeq)`: a batcher that crashes between them is
resumed by the next leader, which finds the block and completes the event updates.

With the defaults the chain grows by at most **86,400 blocks a day** however many events
arrive; at 200 events/s a batch holds ~200 events.

### 3. Proofs

`GET /api/events/{source}/{eventId}/proof` returns the event `data`, `leafHash`, `leafIndex`,
the RFC 6962 audit path, the batch `root`, and the batch block (`index`, `hash`). Verifying needs
nothing from Ernest: recompute the leaf hash from `data`, fold the audit path to the root, check
the root is in the block, check the block in the chain. When the block is covered by an anchor,
the response also carries the existing anchor inclusion receipt (block → anchored root), so an
event is provable all the way to the public anchor.

Paths are recomputed on demand from the batch's leaf hashes (≤ 10,000 leaves — trivial), so no
tree nodes are stored. The CLI (`ernest hashchain verify`) and the WASM verifier gain the
RFC 6962 verification, pinned cross-language by new golden vectors (as
`testdata/qualified-seal-golden.json` pins seals today).

### 4. Reads move to events

- Per-model provenance and integrity read `evidence_events` by `(modelId, seq)`; integrity =
  each event's `leafHash` matches its `data`, and each batch root it belongs to matches the
  block (batch roots verified once and cached per checkpoint).
- `GET /api/verify` verifies the chain of blocks (now small) plus each new batch's root against
  its events, incrementally from the checkpoint as today.
- `GET /api/stats/executions` and `/api/stats/models` aggregate over `evidence_events`.

### 5. Submission semantics

- `POST /api/inferences` (and `/batch`, the ingestor) answer **202 Accepted** with
  `{ eventId, status: "pending" }`; a duplicate answers **200** with the existing record.
- `?wait=true` holds the response until the event's batch is chained (≤ one interval), for
  callers that need the block index synchronously.
- Prudence's delivery semantics already treat "accepted" as delivered (the ingestor path works
  that way); it fetches the inclusion receipt lazily when it needs it (review audit trail,
  attestation verification) instead of storing a block index at delivery time.

### 6. Qualified trust services

- **Emitter seals (ADR-002 B2) stay per event.** They are verified at admission and kept in the
  event `data`, so the batch root commits to them. Nothing about B2 changes for an emitter that
  seals every event.
- **Emitter-side batching (follow-up, not v1).** An emitter that cannot afford one qualified seal
  per event may submit a sealed *batch manifest*: its own RFC 6962 root over N events, sealed
  once, plus the events. Ernest verifies the seal over the manifest root and that the submitted
  events reproduce it. One QTSP call per manifest instead of per event.
- **Ernest's qualified timestamp (ADR-002 B1)** can apply per batch block (`BATCH_QTS=true`,
  ~1 TSA call per interval) or, as today, per anchor. Per anchor is the default; per batch is
  for deployments that need minute-level qualified time.

### 7. Rollout and compatibility

Behind `EVIDENCE_BATCHING=off|on` (default `off`):

1. **Event store and idempotency first**, still writing one block per event — proves the event
   path, dedup and proofs with zero change in chain shape.
2. **Batcher on** for new events. Existing per-event blocks stay valid forever; the chain simply
   continues with `type: "batch"` blocks. Verifiers handle both block kinds.
3. **Ingestor writes events, not blocks** (its worker stops appending to the chain).
4. **Reads move to `evidence_events`** (provenance, integrity, stats).
5. **Prudence**: lazy receipts; stop expecting `blockIndex` in delivery responses.

## Consequences

**Positive**

- Write capacity is MongoDB's insert rate, not one serialized append; adding replicas adds
  capacity. Append races disappear from the hot path.
- Chain-wide work (full verify, anchoring, audit bundles, prune-to-anchor) scales with batches —
  at most 86,400 a day — not with events.
- Idempotent submission by `(source, eventId)` for free.
- Fewer qualified-service calls where it matters (B1 per batch is optional; B2 manifests later).
- Every event remains individually provable, offline, to the chain and to the anchor.

**Negative**

- An event is "pending" for up to one batch interval; synchronous block indexes need `?wait`.
- A new proof format: CLI, WASM verifier, golden vectors and auditor documentation must follow
  before batching is switched on.
- Two Merkle constructions coexist: RFC 6962 for batches, keccak sorted-pairs for anchors (kept
  unchanged — it is the anchoring contract, and existing receipts depend on it). Documented, not
  unified.
- One more moving part: the batcher leader and its lease.

**Neutral**

- ADR-003 is unaffected in principle: leaves are hashes, crypto-shredding erases payload
  plaintext as before, and prune-to-anchor prunes far fewer blocks.

## Alternatives considered

- **Keep one block per event and scale the host.** Phase 0 did this as far as it goes; the
  serialized append remains the ceiling.
- **Shard the chain (one per tenant or risk class) without batching.** Parallelizes writers but
  each shard keeps per-event blocks and the chain-wide costs; cross-shard verification needs a
  root-of-roots anyway. Worth doing *on top of* batching if one chain is ever not enough
  (future ADR).
- **Adopt an external transparency log** (Trillian/Tessera, Sigstore Rekor). Mature and built for
  exactly this, but a heavy operational dependency for a PoC. Tessera's tiled-log format is the
  reference to evaluate if Ernest outgrows MongoDB storage.
- **Kafka (or another broker) in front.** Smooths bursts, which Redis Streams already does; it
  does not lift the chain's append ceiling. *(Superseded for the transport by [ADR-005](adr-005-kafka-ingestion.md):
  once the chain stopped being the limit, the emitter-to-Ernest transport was.)*

## Implementation status

All rollout steps are implemented, switchable with `EVIDENCE_BATCHING=off|events|on` (set the
same value on the backend and the event-ingestor). Steps 1–2 live in the NestJS backend
(`backend/src/blockchain/evidence.service.ts`, `merkle-rfc6962.ts`):

- `events` = rollout step 1: events go through `evidence_events` (idempotent), and the batcher
  appends **one ordinary block per event** with exactly the data a direct append stores — chain
  shape unchanged. Submissions wait for their block by default, so responses still carry
  `blockIndex`/`blockHash`.
- `on` = rollout step 2: one `type: "batch"` block per pass. Submissions answer 202 `pending`
  unless `?wait=true`.

Decisions taken while implementing, refining §1–§3:

- **`seq` is assigned by the batcher, not at insert.** Allocating at insert lets a slow insert
  (seq 5) land after a faster one (seq 6) was already chained, leaving a hole inside a chained
  range. The batcher takes pending events in admission (`_id`) order, allocates a seq range from a
  counter (`counters.evidence_seq`, `$inc` — ranges never overlap, even across a lease handover)
  and stamps it. A batch is "the events whose seq is in `[firstSeq, lastSeq]`"; `size` is
  checked against them.
- **Event states** `pending → assigned → chained`, plus `chain: { kind, firstSeq }` on assigned
  events, so a new leader can finish a crashed one's work.
- **`eventSeq` on the block** (top-level, outside the hashed fields) with a unique partial index:
  chaining a seq range is idempotent — a second leader's append fails on the index and adopts the
  existing block. Crash-before-append and crash-after-append were both exercised.
- **Within a batch, registrations precede inferences** (stable), so causal order never depends on
  ObjectIds from different replicas being ordered.
- **Duplicates:** same `(source, eventId)` and same content (ignoring the server-set
  `executedAt`) → 200 with the stored record; different content → 409. API submissions use
  `source = "api/<modelId>"`, `eventId = inferenceId` (or `model_registration@<version>`).
- **Proof endpoint** is `GET /api/events/{source}/{eventId}/proof` with URL-encoded segments
  (sources contain `/`). It refuses (409) when the store cannot reproduce the batch root, and
  `verifyChain` re-derives every batch root from its events' data.

- **Step 3 — ingestor.** With `EVIDENCE_BATCHING=events|on` the Go worker inserts into
  `evidence_events` (`source` = provider source, `eventId` = `<eventType>:<sourceEventId>`, leaf
  hashed in Go) instead of appending blocks, and marks the ingested event `recorded`. The backend's
  batcher is then the only chain writer. Metric `ernest_writer_events_recorded_total`.
- **Step 4 — reads.** Provenance (`history` entries for batched events carry `seq`, `leafIndex`,
  `status` and `proofUrl`; pending ones have no block yet), per-model integrity (leaves recomputed,
  batch roots re-derived), `/api/stats/models`, `/api/stats/executions` (batched executions count
  by their batch block's index, so the `since`/`upToIndex` window stays exact) and `/api/stats`
  read `evidence_events` alongside blocks. Provenance now verifies the chain incrementally instead
  of re-hashing it on every read. `GET /api/events/export` streams the batched events for offline
  verification.
- **Step 5 — Prudence.** Deliveries treat 202 as delivered (`blockIndex` stays empty: "chaining
  pending"). Attestation verification fetches the event proof lazily and verifies it in Java
  (block hash + RFC 6962 path — not taken on trust), reports `PENDING` while the event awaits its
  batch, and falls back to the provenance scan when Ernest answers 404 (batching off). A 409
  "already recorded with different content" is classified PERMANENT. Prudence's JCS canonicalizer
  gained RFC 8785 number serialization for this.
- **Verifiers.** `testdata/rfc6962-golden.json` (from `scripts/generate-rfc6962-vector.cjs`) pins
  leaves, roots, every audit path and a tampered case, and includes the Certificate
  Transparency reference tree, so the construction is pinned to the standard and not just to
  itself. Reproduced exactly by the backend, the Go CLI (`internal/rfc6962`), merkle-wasm
  (`rfc6962.rs`) and Prudence (`ErnestEventProof`). `ernest proof verify` and the
  `/verify-receipt` page accept event proofs; `ernest hashchain verify` re-derives every batch
  root (`--events` with `--file`; fetched automatically in `--api` and Mongo modes).
- **Duplicates** ignore `signature` as well as `executedAt` when comparing content: a retrying
  emitter re-signs (new `signedAt`, non-deterministic ECDSA) over the same payload.

Not done: golden-test consumers for the new fixture in each language's test suite (verified
with throwaway programs instead), and the emitter-side batch manifests of §6 (follow-up by design).

## Deployment roles (CQRS)

With batching on, writing and chaining are separate steps, so one deployment can split by
responsibility. `ERNEST_ROLE` (comma list; default `all`) selects what a backend process does:

| Role | Serves | Scales |
|---|---|---|
| `reader` | The read API: provenance, proofs, verify, stats, exports. Any non-GET answers 405; runs no jobs and never writes (no indexes, no genesis). | Horizontally, behind a load balancer |
| `writer` | Submissions (`/api/models`, `/api/inferences`, admin writes). With batching it only inserts events. | Horizontally (inserts, unique `(source, eventId)`) |
| `chainer` | The batcher (lease-elected leader), anchoring and the integrity check: the only chain writer. | One active (extra instances wait on the lease) |

High-volume emitters write through the event-ingestor, whose worker also only inserts events.
So writes scale with MongoDB inserts, reads with reader replicas, and the chain grows by one
block per batch from a single chainer. A `writer` without `chainer` refuses to start with
batching `off` — it would append blocks itself and race the chainer. Prudence follows the split
with `prudence.ernest.base-url` (readers) and `prudence.ernest.write-base-url` (a writer).

## Open questions

1. **Legal (eIDAS):** is a per-event emitter seal still required when a qualified timestamp
   covers the batch root, or does seal-over-manifest + inclusion proof give equivalent
   authenticity and integrity for each event? Needs legal confirmation before emitter-side
   batching is offered as a substitute for per-event seals.
2. **Interval and size defaults** (1 s / 1,000): to be confirmed by re-running Prudence's
   `loadtest/` with batching on; target ≥ 5,000 events/s sustained on the reference host with
   proof generation under 10 ms.
3. **Ordering:** `seq` gives a total order of admission. Is per-model order (strictly increasing
   `seq` within a model) sufficient for every consumer, or does any need wall-clock ordering
   across models?
