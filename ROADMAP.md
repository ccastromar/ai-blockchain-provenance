# Ernest Roadmap

Where Ernest is, and where it goes next — with honest status markers, not wishes.

**Guiding principle:** Ernest is an *evidence layer* — it makes records of what an AI
system did provably unaltered, verifiable by a third party without trusting the
operator. Every item below is judged against that, not against "more features."

**The honest headline:** engineering is no longer the bottleneck. The most valuable next
step is not on this list of code — it is putting Ernest in front of one or two regulated
design partners and running a real pilot. The engineering roadmap exists to be *pulled*
by a pilot's needs, not pushed ahead of them.

Status legend: ✅ shipped · 🔜 next (a pilot would likely need it) · 🕓 later · 💡 idea ·
🚫 explicitly not doing (for now).

---

## Where we are

Current tag: `v0.2.0-alpha`. A large batch of evidence features sits in `[Unreleased]`
(see [CHANGELOG.md](CHANGELOG.md)) and would form `v0.3.0-alpha` — "the evidence release".

Shipped this cycle (the four questions a receipt now answers — what / who / when / where):

- ✅ Tamper-evident hashchain, per-model and full-chain verification.
- ✅ SPV-style **inclusion receipts**, verifiable offline (CLI + in-browser WASM).
- ✅ **Anchoring** to EVM *and* OpenTimestamps/Bitcoin (keyless, free — production default).
- ✅ **Signed submissions** (per-emitter Ed25519, ADR-001) — the "who".
- ✅ Roles + revocable auditor tokens; login; access scoping.
- ✅ Cross-language hash/proof/signature **consensus** pinned by golden fixtures in CI.
- ✅ Checkpointed integrity monitoring; constant-memory export; NTP drift detection.
- ✅ **Regulatory mapping** (EU AI Act Art. 12/19, ISO 42001, NIST AI RMF).
- ✅ **CycloneDX 1.6 AI/ML-BOM** export.
- ✅ Continuous **MLflow** integration (registry watcher).

## Now — validation (the real next step)

- 🔜 **One or two regulated design partners** (banking/insurance with Annex III models).
  Everything above exists to make that first meeting succeed.
- 🔜 **One real end-to-end pilot**: a partner instruments a real model, and an auditor
  verifies a real receipt. This is the alpha-exit signal that matters most.
- 🔜 **Cut `v0.3.0-alpha`** when there is someone to hand it to — a tag is most useful
  with a recipient.

## Next — engineering a pilot would pull

- 🔜 **Signed submissions v1.1 — the ingestor path.** ADR-001 covers direct API writes;
  events coming through the Go ingestor (HF/SageMaker/…) still use the HMAC channel
  ladder. Needs its own "signed subset" contract because adapters enrich payloads.
- 🔜 **Enterprise identity (OIDC/SSO)** layered on top of the built-in role/token model —
  per-client identity, not just "whoever holds the key".
- 🔜 **Real provider connectors.** Today 8 providers are *simulated*; the MLflow watcher
  is the one real integration. Make one more provider real, end to end.
- 🔜 **Production anchoring policy** doc: OTS as default; EVM on an L2 (not Sepolia) for
  deployments that want on-chain anchor history; costs/custody guidance.
- 🔜 **Per-model integrity check hardening** — close the neighbor "lazy-tamper" blind spot
  (recompute the predecessor's hash even when it belongs to another model).

## Later

- 🕓 **sigstore keyless envelopes (signing v2)** — OIDC identity + Rekor transparency log,
  as an *additional* envelope type (deferred in ADR-001; must not break air-gapped use).
- 🕓 **in-toto / SLSA provenance attestations** as an export format over the same data
  (natural companion to the CycloneDX export).
- 🕓 **Standards alignment**: W3C PROV, OpenLineage — speak the vocabularies GRC tools use.
- 🕓 **eIDAS qualified trust services** — integrate a qualified electronic timestamp (RFC 3161 QTSP) for anchoring and/or qualified electronic seals for emitter signatures, so evidence carries legal presumption under EU eIDAS, not just cryptographic strength. Positioning more than code; strong EU regulated selling point. See docs/regulatory-mapping.md.
- 🕓 **Streaming CLI verification / export** for chains too large to buffer as one file
  (the server export already streams; the file format could go NDJSON).
- ✅ **Testcontainers CLI integration tests in CI** — the CLI Mongo tests self-provision a container (they already used testcontainers); now run via `go test ./...` in CI and skip gracefully where Docker is absent. (This also pulled the sigverify golden tests into CI, which were silently excluded.)
- 🕓 **Large-artifact references** (IPFS / object store) for evidence that points at big
  blobs without storing them.

## Ideas (unvalidated)

- 💡 **Multi-party / cross-org verification** flows.
- 💡 **Public hash-presence verifier** — "does Ernest have a record of this artifact?"
  (positive presence only; not an AI-content detector).
- 💡 Real-time dashboards / streaming provenance.

## Explicitly not doing (for now)

- 🚫 **AI-content detection** ("is this image/text AI-generated?") — a different product
  (probabilistic ML classification), and mixing it in would devalue the strong
  cryptographic guarantee with a weak statistical one.
- 🚫 Being a **model registry** or **experiment tracker** — Ernest sits *beside* MLflow,
  it does not replace it.
- 🚫 Storing raw prompts, inputs, outputs, datasets or model binaries.

## Alpha-exit criteria (from `docs/maturity-model.md`) — status

| Criterion | Status |
|---|---|
| A real model-registry / ML-platform integration demonstrated | ✅ MLflow watcher (one real; more would strengthen it) |
| Write clients can sign provenance submissions | ✅ ADR-001 (direct API); 🔜 ingestor path |
| Authentication delegated to an enterprise identity provider | 🔜 OIDC/SSO on top of roles/tokens |
| Backup and restore tested on the target deployment shape | ✅ scripts + runbook (test on the real target during the pilot) |
| A pilot threat model reviewed with security stakeholders | 🔜 needs the design-partner conversation |

The gating items left are **not more code** — they are a pilot and a security review with
a real counterparty. That is the roadmap.
