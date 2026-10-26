# Prudence decision events · contract v1

How each PDP decision reaches Ernest when Prudence delivers decisions through Ernest's
event-ingestor (`prudence.ernest.decision-transport=kafka`, as the suite deploys it, or
`ingestor` over HTTP). Prudence is the producer and owns this contract; Ernest's event-ingestor
consumes it.

| File | What it is |
| --- | --- |
| `README.md` | This contract (normative) |
| `vectors.json` | Decisions → the exact Kafka record → what Ernest derives |
| `sync.sh` | Copies this directory into Ernest's event-ingestor with a `SOURCE` of SHA-256 sums |

| Side | Test |
| --- | --- |
| Producer: Prudence (`ErnestEvidenceAdapter`, `ErnestKafkaPublisher`) | `DecisionEventsContractTest`: every case gives exactly its `record` |
| Consumer: Ernest's event-ingestor (`kafkasource`, `events.Normalize`) | `kafkasource/decision_events_contract_test.go`: every `record` is read as its `ernest` says |

## 1. The record

- **Topic**: `prudence.ernest.kafka-topic` (the suite uses `prudence.decisions`).
- **Key**: the AI system id, so one system's decisions stay in order on one partition.
- **Headers**: `source` = `prudence-pdp`, `eventType` = `policy.decision`, `sourceEventId` = the
  `decisionId` Prudence returned to the gate.
- **Value**: JSON with `modelId` (the AI system), `modelName` and `aiSystem` (`id`, `name`,
  `riskTier`, `systemOfRecord: "prudence"`; name and tier only when Prudence knows them),
  `decisionId` = `inferenceId`, `inputHash` = SHA-256 of `subject|pipeline|action`,
  `outputHash` = SHA-256 of `decision|reason`, and `metadata` (stage `governance_decision`, the
  decision, its reason, the policy version and digest, the system version and model hash, and
  causal ids when known).

Over HTTP (`POST /events`) the same value travels, with the headers as `X-Ernest-Event-Source`,
`X-Ernest-Event-Type` and `X-Ernest-Source-Event-Id`.

Only workload identities, ids, verdicts and digests travel: no prompt, input or output.

## 2. What Ernest makes of it

- The decision is deduplicated on (`source`, `eventType`, `sourceEventId`), so a re-sent
  decision (Prudence's outbox retries) records nothing new. Its evidence event id is
  `policy.decision:<decisionId>`.
- It is an inference of type `policy_decision` under `modelId`, with the hashes as sent.
- The `aiSystem` block names Prudence the system of record: Ernest shows the system by the name
  and tier Prudence gave and leaves its lifecycle to Prudence.

## 3. Changing it

Change `vectors.json` with the code (`mvn test -Dtest=DecisionEventsContractTest
-Dcontract.update=true` rewrites the records), commit, run `sync.sh`, and make Ernest's test
pass. A change to a field Ernest reads, or to how the ids are formed, is a new version
(`policy.decision.v2`), published alongside v1 for a suite release.
