# Security Policy

Ernest records tamper-evident AI evidence, anchors it and issues receipts anyone can verify
offline. Its maturity is alpha: review `docs/security-model.md` and `docs/threat-model.md` before
using it with regulated or sensitive data.

## Reporting a vulnerability

Please do not report vulnerabilities in public issues. Use GitHub's private vulnerability
reporting: the repository's **Security** tab → **Report a vulnerability**. Include the version or
commit, what an attacker can do and how to reproduce it; leave out real secrets and personal data.
Only the latest release receives fixes.

## Scope

Security-sensitive areas include:

- Authorization by governance function: `evidence.write` writes evidence, `platform.admin`
  operates Ernest (tokens, emitter keys, anchors, legal holds), any function reads. Tokens from the
  identity provider (`OIDC_ISSUER`, `OIDC_AUDIENCE`) resolve through the governance model
  (`ERNEST_GOVERNANCE_MODEL`); static keys and access tokens keep working.
- Hash-chain integrity, Merkle batching and the integrity checks.
- Anchoring: the EVM private key, OpenTimestamps and RFC 3161 timestamps.
- Signed submissions (emitter keys, qualified seals) and the event ingestor's sources.
- Data lifecycle: retention, legal holds and archives.

## Deployment expectations

- Configure the identity provider or `ERNEST_API_KEY`; `ERNEST_PUBLIC_READ_ONLY` only for a
  public evidence portal.
- Restrict `CORS_ORIGIN` and keep MongoDB, Redis and Kafka private.
- Prefer OpenTimestamps anchoring; if you use an EVM wallet, keep its key in a secrets manager and
  its balance low.
- Never bake an API key into a browser build (`PUBLIC_ERNEST_API_KEY` is a public value).

## Automated checks

Every push and pull request runs CodeQL static analysis and a secret scan of the whole history
(`.github/workflows/security.yml`); Dependabot proposes dependency updates weekly; release images
are scanned with Trivy and not published if a critical vulnerability with a fix is found.

## Verifying release images

Release tags publish images to GHCR, each signed with Sigstore cosign (keyless, by the release
workflow itself) and carrying an SBOM and build provenance. Check an image before you run it:

```bash
cosign verify ghcr.io/ccastromar/ai-blockchain-provenance-backend:0.3.0 \
  --certificate-identity-regexp '^https://github.com/ccastromar/ai-blockchain-provenance/\.github/workflows/publish-images\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify ghcr.io/ccastromar/ai-blockchain-provenance-event-ingestor:0.3.0 \
  --certificate-identity-regexp '^https://github.com/ccastromar/ai-blockchain-provenance/\.github/workflows/publish-images\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify ghcr.io/ccastromar/ai-blockchain-provenance-frontend:0.3.0 \
  --certificate-identity-regexp '^https://github.com/ccastromar/ai-blockchain-provenance/\.github/workflows/publish-images\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker buildx imagetools inspect ghcr.io/ccastromar/ai-blockchain-provenance-backend:0.3.0 --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/ccastromar/ai-blockchain-provenance-backend:0.3.0 --format '{{ json .Provenance }}'
```
