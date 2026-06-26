# Security Policy

Ernest is currently a proof-of-concept. Please do not use it as-is for regulated, sensitive, or production workloads without adding the controls described in the README security checklist.

## Reporting a Vulnerability

Please do not report vulnerabilities through public GitHub issues.

Until a dedicated security contact is published, send a private message to the maintainer or open a minimal public issue that says only that you have a security report to share. Do not include secrets, exploit details, private keys, patient data, customer data, or other sensitive information in public channels.

## Scope

Security-sensitive areas include:

- Write endpoints protected by `ERNEST_API_KEY`.
- MongoDB hashchain integrity.
- Sepolia anchoring and private-key handling.
- Frontend handling of `NEXT_PUBLIC_ERNEST_API_KEY`.
- Auditor and sandbox integrations that call the backend.

## Expectations

- Use `ERNEST_API_KEY` for public demos.
- Restrict `CORS_ORIGIN`.
- Keep MongoDB private.
- Store `PRIVATE_KEY` in a secrets manager.
- Use a low-balance Sepolia wallet for demos.
