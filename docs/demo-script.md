# Demo Script

Use this script for a 5-minute company or incubator presentation. It assumes the stack
is already running and the dashboard is available. The demo builds to one moment: an
evidence receipt that still verifies **after you shut the server down**.

## Setup

- Dashboard: `http://localhost:3000` or the public demo URL.
- API docs: `http://localhost:3001/api/docs` or `/api/docs` behind the proxy.
- If access keys are configured, sign in at `/login` with the read-write key beforehand.
- For the anchoring/receipt finale, have at least one confirmed anchor covering the
  demo blocks. Self-contained option: start with
  `docker compose -f docker-compose.yml -f docker-compose.local-chain.yml --env-file .env.local-chain up -d --build`
  and trigger `POST /api/anchors` after seeding.
- Optional terminal ready with the `ernest` CLI for the alternative offline finale.

## Talk Track

### 1. Frame the problem (30s)

AI governance teams are being asked to keep records of what their AI systems did —
the EU AI Act makes automatic event logging a legal requirement for high-risk systems
(see [regulatory-mapping.md](regulatory-mapping.md)). Most teams have logs. Almost
nobody can prove their logs weren't edited afterwards.

Key point: Ernest is not a model registry or a data platform. It records
**tamper-evident evidence** beside them — hashes and metadata, never raw data.

### 2. Seed and register (60s)

Click **Seed demo** on the dashboard (or register `credit-risk-logreg-v1` manually with
a SHA-256 artifact hash and a git commit).

Explain while it loads:

- Every event becomes a block in an append-only hashchain; each block's hash covers
  its content and the previous block's hash.
- Inference evidence is hash-only: client systems hash inputs/outputs outside Ernest.
- Concurrent writers can't fork the chain (unique index serialization), and an
  inference can never be recorded before its model's registration.

### 3. Show the chain being watched (45s)

Open the **Blocks** explorer: pick a block, show the recomputed link verification.
Mention what they can't see: an hourly integrity check re-verifies the chain from a
checkpoint, re-validates the anchored Merkle root, and pages a webhook if anything
stops adding up — tampering doesn't wait for someone to look.

If asked about access: the badge in the header. Read-only keys and revocable,
expiring auditor tokens are built in (`/settings/tokens`).

### 4. Anchor (30s)

Show `GET /api/anchors/status`, trigger `POST /api/anchors` if using the local chain.

- Ernest computes a Merkle root over the chain and publishes **only that root** —
  32 bytes and organizational metadata, never data.
- From this moment, rewriting the anchored history is detectable by anyone,
  including against us, the operators.

### 5. The finale: a receipt that doesn't need us (90s)

1. In the block explorer, open the inference block for the credit decision and click
   **⬇ Receipt**. Show the file: the block, ~a dozen hashes, the anchor transaction.
2. Open `/verify-receipt`, drop the file: two green checks — data reproduces its
   hash, proof reaches the anchored root. Point out it ran **in the browser, via
   WebAssembly; nothing was sent anywhere**.
3. Now the moment: `docker compose stop backend`. Reload the dashboard — dead.
   Verify the receipt again on `/verify-receipt` (the page is static) — **still
   green**.

Say it plainly: *the auditor does not need to trust our servers, our database, or our
uptime. The evidence stands on its own, against a public chain.*

(Terminal alternative: `ernest proof verify receipt.json` — same two checks, same
independence. Bring the backend back with `docker compose start backend`.)

### 6. Close with the path (30s)

- Regulatory fit: [regulatory-mapping.md](regulatory-mapping.md) — EU AI Act Art. 12
  record-keeping is exactly this shape of evidence.
- Next milestones: signed client submissions (who wrote each event), enterprise
  identity (OIDC/SSO on top of the built-in roles), one production ML-platform
  integration, production anchoring policy.

## Expected Questions

| Question | Short Answer |
| --- | --- |
| Does Ernest store prompts or inference outputs? | No. Hashes and metadata only, by design. |
| Is this production-ready? | No — alpha, honest about it. See the threat model for exact guarantees and non-guarantees. |
| What does blockchain add? | A public 32-byte commitment that makes rewriting history detectable by outsiders. No data goes on-chain, and it's optional. |
| Can a client lie about a hash? | Yes — Ernest proves what was recorded and when, not that it was true. Signed submissions are the planned control for *who*. |
| Access control? | Read-write vs read-only keys plus named, revocable, expiring auditor tokens, enforced API-wide. Enterprise SSO is the next layer, not a replacement. |
| What if someone edits the database? | Detected: hourly checkpointed integrity checks, anchored-root re-validation, webhook alerts — and any auditor with a receipt or export can catch it independently. |
| MLflow / registry integrations? | An MLflow adapter exists for demos; a production-grade integration is the declared alpha-exit milestone. |
