# cli-ernest

Independent verifier and query tool for an Ernest hashchain. Its main job is the
auditor story: **re-verify the chain without trusting the Ernest server** — and, in the
API/file modes, without any database credentials.

The hash recomputation uses the same canonicalization law as the NestJS backend and the
Go event-writer, pinned byte-for-byte by the shared golden vectors in
[`../testdata/hash-golden-vectors.json`](../testdata/hash-golden-vectors.json).

## Verify the chain

Three block sources, in priority order:

```bash
# 1. Offline: verify an export bundle (no network, no credentials)
curl -H "X-Ernest-Api-Key: $READ_ONLY_KEY" https://ernest.example.com/api/blocks/export -o chain.json
./ernest hashchain verify --file chain.json

# 2. Online through the API — a read-only key or auditor token suffices
./ernest hashchain verify --api https://ernest.example.com --key $READ_ONLY_KEY
#    (--api defaults to $ERNEST_URL, --key defaults to $ERNEST_API_KEY)

# 3. Legacy/forensic: direct MongoDB access from the host itself
MONGO_URI=mongodb://127.0.0.1:27017 BLUEPRINT_DB_DATABASE=ernest ./ernest hashchain verify
```

When a block embeds an ADR-001 emitter signature, `proof verify` also checks it
offline and reports the signing `keyId`. Generate emitter keypairs with
`./ernest emitter keygen`.

A tampered block or broken `previousHash` link reports the exact block index and the
mismatching hashes, and the command exits non-zero.

## Verify an inclusion receipt

An evidence receipt (`GET /api/blocks/:index/proof`) proves one block belongs to an
anchored Merkle root — ~log₂(N) hashes instead of the whole chain:

```bash
curl -H "X-Ernest-Api-Key: $READ_ONLY_KEY" https://ernest.example.com/api/blocks/42/proof -o receipt.json
./ernest proof verify receipt.json
```

Verification is fully offline: the block data must reproduce its hash (shared
canonicalization) and the hash must climb the proof path to the anchored root
(keccak256, sorted pairs, pinned by `../testdata/merkle-proof-golden.json`). The
printed anchor transaction lets anyone confirm the root on the public chain.

## Other commands

Direct-MongoDB query helpers (`MONGO_URI` + `BLUEPRINT_DB_DATABASE`):

- `provenance height` — chain height
- `provenance list` / `get-by-index` / `get-by-hash` — inspect blocks
- `aimodels list` / `get` / `count` — inspect registered models

## Build and test

```bash
make build          # or: go build -o ernest .
go test ./cmd/... ./internal/db/repositories/... ./internal/hashcanon/...
```

`internal/hashcanon` is a mirror of the event-writer's canonicalizer; a guard test
fails if the two files ever drift apart.
