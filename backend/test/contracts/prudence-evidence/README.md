# Prudence → Ernest evidence · contract v1

What Prudence needs from Ernest: the requests it sends to record governance evidence (reviews,
PDP decisions, attestations) and the fields it reads back to confirm it and to compute Posture.
Prudence is the consumer and writes this contract; Ernest is the provider and verifies it.

| File | What it is |
| --- | --- |
| `README.md` | This contract (normative) |
| `interactions.json` | The interactions, in the order Ernest replays them |
| `sync.sh` | Copies this directory into Ernest with a `SOURCE` of SHA-256 sums |

| Side | Test |
| --- | --- |
| Consumer: Prudence's adapters (`ReviewSealAdapter`, `ErnestEvidenceAdapter`, `ErnestAttestationAdapter`, `ErnestEvidenceHealthAdapter`) | `ErnestEvidenceContractTest`: the adapters against a stub that answers each interaction with its example |
| Provider: Ernest's backend | `backend/test/prudence-contract.test.js`: the real application (MongoDB, `EVIDENCE_BATCHING=on`, as the suite deploys it) answers every interaction |

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
| `eventually` | Ernest may need a moment (a batch to chain): it is asked again for up to 5 s |

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
- A chained event's proof carries what Prudence verifies itself: the event's data, the RFC 6962
  inclusion path and the block. The example proof is a real one from Ernest v0.3.
- Posture reads: `GET /api/verify`, `/api/stats/models`, `/api/models/{id}/integrity`,
  `/api/stats/executions`.

Not covered yet: the fallbacks for an Ernest without batching or older than v0.3
(`/api/provenances/{m}`, paging `/api/blocks`), the decision transports through the
event-ingestor or Kafka, and qualified seals (QTSP).

## 4. Changing it

Change `interactions.json` here with the adapter change, commit, run `sync.sh`, and make
Ernest's verification pass. A change Ernest cannot satisfy without breaking another consumer
is a new contract version, kept alongside v1 for a suite release.
