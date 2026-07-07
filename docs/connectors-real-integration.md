# Wiring Real Provider Connectors

**What this document is:** the honest recipe for turning Ernest's provider connectors
from *simulated* into *real*, one provider at a time.

**The thing to understand first:** the per-provider **adapters are already real**. Each
adapter (`event-ingestor/internal/adapters/<provider>/`) parses the provider's *actual*
event/webhook JSON and normalizes it to Ernest's canonical event. What is simulated is not
the translation — it is the **source**. The `POST /api/ingestor/simulate/<provider>`
endpoints fabricate a sample payload and push it through the real pipeline.

So "maturing" a connector is **not** rewriting an adapter. It is **connecting the real
source** to the ingestor, and — where the source only announces *that* something changed —
**enriching** the event until it carries the artifact hash we actually want to seal.

---

## The ingestor's real intake

Every real integration ends at one HTTP endpoint on the event-ingestor:

```
POST /events/<provider>
```

Providers wired today: `huggingface`, `sagemaker`, `azureml`, `databricks`, `vertexai`,
`cloudevents`, `openlineage`, `opentelemetry/logs`, plus the generic `POST /events`.

### Authentication (already built — pick per source)

| Mechanism | Header(s) | Env var | Used by |
| --- | --- | --- | --- |
| **HF webhook secret** | `X-Webhook-Secret` (or `?secret=`) | `HF_WEBHOOK_SECRET` | Hugging Face's native webhook |
| **Provider HMAC** | `X-Ernest-Provider-Signature` + `X-Ernest-Provider-Timestamp` (replay tolerance `PROVIDER_HMAC_TOLERANCE_SECONDS`, default 300s) | `EVENT_PROVIDER_HMAC_SECRET` | any bridge you control (EventBridge target, Event Grid handler, a poller) |
| **Ingest API key** | `X-Ernest-Ingest-Key` | `EVENT_INGESTOR_API_KEY` | simple trusted callers |

For the generic `/events` path you can also set the event identity by header:
`X-Ernest-Event-Source`, `X-Ernest-Event-Type`, `X-Ernest-Source-Event-Id`.

**Idempotency is free.** Ernest rejects a duplicate `(modelId, version)` (or duplicate
`sourceEventId`) with `400` *before* touching the hashchain. Every real source is therefore
allowed to be at-least-once: crash-safe pollers and webhook retries bounce off harmlessly.

---

## The two integration patterns

The eight providers do **not** mature the same way. They split by how the source emits.

### Pattern A — Push (native webhook). The source calls Ernest.

Easiest. The provider POSTs on its own when something changes; you register a URL + secret.

- **Hugging Face** — native repo/model/discussion webhooks. Configure Ernest's public URL
  and a secret in the repo/org webhook settings; the adapter and `X-Webhook-Secret`
  verification already exist. **This is the recommended first real connector** (see below).
- **Databricks** (managed) — Model Registry webhooks fire on model-version stage
  transitions. Same shape as HF: register URL + auth, point at `/events/databricks`.

### Pattern B — Pull (poller). Ernest fetches from the source's API.

For sources **without** usable webhooks, or where you don't want the customer to configure
cloud eventing infra. **This pattern is already proven**: `integrations/mlflow/watch_mlflow.py`
polls the MLflow registry, and it is the template to copy.

The MLflow watcher shows every moving part a pull connector needs:

- poll the registry API on `WATCHER_POLL_SECONDS`,
- keep a **watermark** state file so restarts don't re-scan from zero,
- **backfill** mode (`all` | `none`) for the first run,
- submit to Ernest and let Ernest's duplicate-`400` provide idempotency.

Applies directly to the hyperscaler registries — **poll their Model Registry API instead of
asking the customer to stand up cloud eventing**, which is a decisive simplification for a
pilot ("give me a read-only registry credential" beats "configure EventBridge"):

- **SageMaker** — poll the SageMaker Model Registry (model package groups / versions), or,
  if the customer prefers push, an **EventBridge** rule → API destination → `/events/sagemaker`.
- **Azure ML** — poll the workspace model registry, or **Event Grid** subscription →
  `/events/azureml`.
- **Vertex AI** — poll the Model Registry, or **Eventarc/Pub-Sub** push → `/events/vertexai`.

### Pattern C — Formats, not platforms. Point a real emitter at Ernest.

These are specs; the adapter already speaks them. "Making them real" means a real system
emits to Ernest — no new Ernest code.

- **CloudEvents** — any CloudEvents producer → `/events/cloudevents`.
- **OpenLineage** — Airflow / dbt / Spark can emit OpenLineage over HTTP; set their
  transport URL to `/events/openlineage`.
- **OpenTelemetry** — an OTel collector with an HTTP exporter → `/events/opentelemetry/logs`.

---

## The enrichment caveat (the real work per provider)

A webhook usually tells you *"version X changed"*, **not the hash of the model artifact**
you want to seal. That gap — not parsing — is the real work.

- Hugging Face gives `repo.headSha` (a real git commit identity — the adapter maps it to
  `gitCommit`), which is a legitimate anchor **for the repo state**. But to seal the model
  *binary*, you still need to fetch and hash it.
- This is exactly what the MLflow watcher does on the pull side: it downloads the artifact
  and computes `sha256` before submitting. Push connectors that need a binary hash must do
  the same enrichment step — receive the webhook, then fetch-and-hash via the provider API
  before (or as part of) the submission.

Decide per connector **what identity you are sealing**: a commit SHA (cheap, from the
webhook) or the artifact hash (needs an enrichment fetch). Both are valid; be explicit
about which, because it determines what a receipt actually proves.

## What connectors are *not* for

Connectors carry **model-lifecycle** events (a version was registered / promoted). They do
**not** carry **per-inference** evidence — ML platforms don't emit an event per inference.
Per-inference sealing is always the direct signed-API path (ADR-001), never a connector.
Keep this line clear in any pitch: connectors = provenance of *which model exists*;
direct API = provenance of *what each inference did*.

---

## Recommended first real connector: Hugging Face, end to end

The lowest-effort path from "8 simulated" to a credible "1 real + MLflow real + 6
documented":

1. Expose the event-ingestor over public HTTPS (reverse proxy → ingestor `PORT`, default
   `3011`).
2. Set `HF_WEBHOOK_SECRET` on the ingestor.
3. In the HF repo/org **Settings → Webhooks**, add Ernest's `https://.../events/huggingface`
   URL, the same secret, and subscribe to repo-content / discussion events.
4. Push a change to the watched repo; confirm a real block appears (the adapter maps
   `repo.headSha` → `gitCommit`).
5. If sealing the artifact (not just the commit) matters for the use case, add the
   fetch-and-hash enrichment against the HF API before submission.

That converts the story from *"eight simulated providers"* to *"one real webhook (HF), one
real poller (MLflow), and six documented paths that reuse the same two patterns"* — a far
more credible pilot narrative.

---

## Summary table

| Provider | Pattern | Real-source wiring | Native webhook? |
| --- | --- | --- | --- |
| Hugging Face | A (push) | repo/org webhook → `/events/huggingface`, `X-Webhook-Secret` | ✅ yes |
| Databricks (managed) | A (push) | Model Registry webhook → `/events/databricks` | ✅ yes |
| MLflow (OSS) | B (pull) | `watch_mlflow.py` poller (**already real**) | ❌ no |
| SageMaker | B (pull) *or* push | poll Model Registry API, or EventBridge → `/events/sagemaker` | via EventBridge |
| Azure ML | B (pull) *or* push | poll model registry, or Event Grid → `/events/azureml` | via Event Grid |
| Vertex AI | B (pull) *or* push | poll Model Registry, or Eventarc/Pub-Sub → `/events/vertexai` | via Eventarc |
| CloudEvents | C (format) | point any producer at `/events/cloudevents` | n/a (spec) |
| OpenLineage | C (format) | Airflow/dbt/Spark transport → `/events/openlineage` | n/a (spec) |
| OpenTelemetry | C (format) | OTel collector exporter → `/events/opentelemetry/logs` | n/a (spec) |

See also: [event-ingestion-layer.md](event-ingestion-layer.md) (the pipeline the adapters
feed), [integrations.md](integrations.md), and `integrations/mlflow/watch_mlflow.py` (the
pull template).
