# Prudence → Ernest evidence · contract v1

What Prudence needs from Ernest: the requests it sends to record governance evidence (reviews,
PDP decisions, attestations) and the fields it reads back to confirm it and to compute Posture.
Prudence is the consumer and writes this contract; Ernest is the provider and verifies it.

| File | What it is |
| --- | --- |
| `README.md` | This contract (normative) |
| `interactions.json` | The interactions, in the order Ernest replays them, with batching on (as the suite deploys Ernest) |
| `interactions-events.json` | The same conversation in Ernest's default mode, `events` (one block per event) |
| `interactions-unbatched.json` | The same conversation with batching turned off |
| `sync.sh` | Copies this directory into Ernest with a `SOURCE` of SHA-256 sums |

| Side | Test |
| --- | --- |
| Consumer: Prudence's adapters (`ReviewSealAdapter`, `ErnestEvidenceAdapter`, `ErnestAttestationAdapter`, `ErnestEvidenceHealthAdapter`) | `ErnestEvidenceContractTest`: the adapters against a stub that answers each interaction with its example |
| Provider: Ernest's backend | `backend/test/prudence-contract.test.js` (`EVIDENCE_BATCHING=on`), `prudence-contract-events.test.js` (`events`) and `prudence-contract-unbatched.test.js` (`off`): the real application on MongoDB answers every interaction |

## 1. Interactions

Each interaction has an `id`, the `consumer` class that sends it (none for a setup step another
runtime performs), a `request` (method, raw path with its query, JSON body) and a `response`:

| Field | Meaning |
| --- | --- |
| `status` | The status, or the statuses Prudence accepts (the stub answers with the last) |
| `body` | An example: every field in it is one Prudence reads |
| `equal` | Top-level fields whose value must be exactly the example's |
| `oneOf` | `list[].field` → the values allowed in every element |
| `contains` | Text the raw answer must contain, because Prudence looks for it |
| `eventually` | Ernest may need a moment (a batch to chain, its chain index to catch up): it is asked again for up to 15 s |

Ernest replays the interactions in order against an empty database, so each one sees the state
the previous ones left.

## 2. Matching

- **Requests (checked in Prudence).** What an adapter sends has the same fields at every level
  as the interaction's body, with the same JSON types. Values may differ (hashes, times).
- **Answers (checked in Ernest).** Every field of the example is in the answer, with the same
  JSON type; in an array, every element matches the example's element at that position (or its
  last). Ernest may add fields freely; it may not remove, rename or retype one Prudence reads.

## 3. What this pins

- Writes with batching are accepted before they are chained: `202` with no block index.
- A record re-sent with the same content is a duplicate (`200`); with other content, a `409`
  whose message says "already recorded with different content" (Prudence dead-letters it).
- Registering a model twice answers `400` "already exists" (Prudence treats it as done).
- People travel only as keyed pseudonyms (`reviewerPseudonym`; see `EvidencePseudonyms`): the
  consumer test fails if a reviewer's name reaches a request.
- A chained event's proof carries what Prudence verifies itself: the event's data, the RFC 6962
  inclusion path and the block. The example proof is a real one from Ernest v0.3.
- Posture reads: `GET /api/verify`, `/api/stats/models`, `/api/models/{id}/integrity`,
  `/api/stats/executions`.

In `events`, Ernest's default, every write goes through the event store like `on` (duplicates,
`409` conflicts) but is chained in its own block before it answers (`200`/`201` with
`blockIndex`), and the proof's inclusion kind is `block`: Prudence checks the block hash and that
the event's data is the block's.

With batching off, writes are chained at once (`200`/`201` with `blockIndex`), there is no event
store (`GET /api/events/…/proof` is `404`), and Prudence confirms an attestation through the
model's provenance (`GET /api/provenances/{m}`: `chainValid`, `history[].inputHash`,
`blockIndex`).

**Not guaranteed with batching off:** Ernest does not deduplicate. A record re-sent by Prudence's
outbox is chained again as a new block, and one re-sent with other content is accepted (`200`)
instead of refused (`409`). Do not turn batching off where Prudence delivers evidence (Ernest's
default, `events`, deduplicates); the unbatched interactions leave those two cases out.

Not covered: paging `/api/blocks` (the fallback for an Ernest older than v0.3), and qualified
seals (QTSP). The decision transports through the event-ingestor are `contract/decision-events/`.

## 4. Changing it

Change `interactions.json` here with the adapter change, commit, run `sync.sh`, and make
Ernest's verification pass. A change Ernest cannot satisfy without breaking another consumer
is a new contract version, kept alongside v1 for a suite release.
