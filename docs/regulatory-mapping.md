# Regulatory Mapping

**What this document is:** an honest map from regulatory record-keeping obligations to
the technical evidence Ernest produces.

**What it is not:** a compliance claim. Ernest does not make an organization compliant
with anything. Compliance is process, scope classification, documentation and legal
judgment — Ernest contributes one specific ingredient those processes need and rarely
have: **event records that a third party can verify were not altered after the fact.**

The bank credit-risk scenario used throughout the Ernest documentation is not
hypothetical for these frameworks: creditworthiness evaluation of natural persons is a
listed high-risk use under the EU AI Act (Annex III), which makes its record-keeping
obligations directly applicable to exactly that kind of system.

## EU AI Act (Regulation (EU) 2024/1689)

Most obligations for high-risk AI systems apply from **August 2026** — organizations
deploying Annex III systems are building their logging story now.

| Obligation | What it requires | What Ernest provides | What remains yours |
| --- | --- | --- | --- |
| **Art. 12 — Record-keeping** | High-risk AI systems must technically allow the automatic recording of events (logs) over the system's lifetime, to ensure traceability of its functioning | Automatic, append-only recording of model lifecycle events and per-inference evidence (hash-only), with tamper-evidence: any later modification of a recorded event is detectable by continuous integrity checks and independently by auditors (CLI, offline export, per-event receipts) | Deciding *which* events your system must record for its risk profile; instrumenting the system to submit them |
| **Art. 19 / Art. 26 — Log retention** | Providers and deployers keep the automatically generated logs under their control (at least six months, unless other law requires more) | Durable storage with documented backup/restore ([backup-recovery.md](backup-recovery.md)); exports whose integrity is verifiable at restore time — a log archive you can *prove* is the one you kept | Retention policy, legal hold, deletion workflows (explicitly a known gap — see [threat-model.md](threat-model.md)) |
| **Art. 13 — Transparency to deployers** | Instructions and information enabling deployers to understand and use the system | CycloneDX 1.6 AI/ML-BOM export per model (versions, artifact hashes, commits, metrics) as machine-readable model documentation | Human-readable instructions for use, intended-purpose documentation |
| **Traceability across the value chain** (recitals; Arts. 12/13 combined) | Which model version produced which output, reconstructable later | The hashchain links registration → version → inference evidence; SPV receipts prove a specific event existed before an anchored point in time, verifiable without trusting the operator | Feeding truthful inputs (Ernest preserves what was recorded; it cannot detect honest-looking lies — see threat model N2) |

## ISO/IEC 42001:2023 (AI Management Systems)

| AIMS theme | What Ernest contributes |
| --- | --- |
| Event logging and traceability controls for AI systems in operation | The append-only evidence chain with scheduled integrity verification and alerting (`WEBHOOK_URL`) |
| AI system documentation and technical evidence | Model records with artifact hashes and git commits; AI/ML-BOM export |
| Independent audit support | Read-only auditor credentials (expiring, revocable tokens), offline chain export, per-event receipts verifiable outside the organization's infrastructure |
| Records integrity for management-system audits | Cross-language verification (backend, CLI, browser/WASM) pinned by public golden fixtures — the verifier does not have to trust the operator's software build |

## NIST AI RMF 1.0

| Function | Relevant outcome | Ernest's contribution |
| --- | --- | --- |
| GOVERN | Accountability structures; documentation of AI system provenance | The evidence chain as the system of record for "what ran, when, at which version" |
| MAP | AI system context and components documented | Model registration with artifact/commit identity; connector events from ML platforms |
| MEASURE | Mechanisms to track AI system trustworthiness over time | Tamper-evident inference evidence linked to model versions; audit-readiness scoring of evidence completeness |
| MANAGE | Incident response and post-hoc analysis | Verifiable reconstruction of which model version was live at a decision point; receipts as portable incident evidence |

## eIDAS (EU Regulation 910/2014, and eIDAS 2.0 — Regulation (EU) 2024/1183)

Where the AI Act says *"keep records of what your AI system did,"* eIDAS is the framework
that says *"here is how electronic records and signatures acquire legal trust in the EU."*
The two are complementary: the AI Act is the obligation, eIDAS is the trust layer.

eIDAS defines **trust services**, each available in a *qualified* form (provided by a
Qualified Trust Service Provider on an EU Trusted List, carrying a **legal presumption**)
or a non-qualified form. Ernest's primitives map conceptually to three of them:

| eIDAS trust service | Ernest's corresponding primitive | Qualified? |
| --- | --- | --- |
| **Electronic timestamp** | Anchoring (OpenTimestamps/Bitcoin, EVM) — proof a record existed before a point in time | **No** — cryptographically strong, but not from a qualified TSA |
| **Electronic seal** (origin + integrity, for a legal person/system) | Per-emitter Ed25519 signed submissions (ADR-001) | **No** — self-managed keys, not QTSP-issued seal certificates |
| **Electronic ledger** (eIDAS 2.0 — records with integrity and accurate chronological order) | The tamper-evident hashchain itself | **No** — the architecture matches; the *qualified* status does not |

**The honest gap:** Ernest is **not** a Qualified Trust Service Provider. Its timestamps
and seals are cryptographically sound and independently verifiable, but they do **not**
carry the automatic legal presumption that *qualified* eIDAS services do. Saying otherwise
would be the kind of overclaim this whole document exists to avoid.

**The integration path (positioning, mostly not code):** Ernest can *incorporate*
qualified trust services without ceasing to be Ernest —

- anchor additionally with a **qualified electronic timestamp** (an RFC 3161 TSA operated
  by a QTSP) alongside the blockchain anchor, and/or
- let emitters sign with **qualified electronic seals** (QTSP-issued certificates) instead
  of, or in addition to, self-managed Ed25519.

That upgrades the evidence from *"cryptographically verifiable"* to *"legally qualified
under eIDAS"* — a decisive line for EU regulated buyers. See `ROADMAP.md` (Later).

*Caveat:* eIDAS 2.0 and its implementing acts (the electronic ledger trust service, the
EU Digital Identity Wallet) are being rolled out through 2025–2026; the precise
requirements for a *qualified electronic ledger* are still settling. Treat this as
strategic direction, not settled letter.

## GDPR (note)

Ernest stores **hashes and metadata only** — by design it holds no prompts, inputs,
outputs, or training data, which keeps the evidence layer itself out of most personal-data
scope (a hash of personal data may still be personal data in some analyses; consult your
DPO for classification). For Art. 22 (automated decision-making) accountability, Ernest
answers the forensic half of the question: *which* model version produced the decision,
and that the record of it has not been rewritten since.

## The one-sentence version

Regulators ask you to keep trustworthy records of what your AI systems did. Ernest makes
those records **provably trustworthy** — to you, to your auditor, and to anyone you hand
a receipt — without ever holding the sensitive data itself.
