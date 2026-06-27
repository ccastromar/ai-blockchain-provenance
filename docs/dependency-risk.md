# Dependency Risk Policy

Ernest uses `pnpm` for JavaScript dependency reproducibility across the backend, frontends, and blockchain workspace packages.

## Audit Commands

Production dependency audit:

```bash
pnpm run audit:prod
```

Full audit, including development tooling:

```bash
pnpm run audit:all
```

Both commands default to `high` severity or higher. To review lower severities:

```bash
AUDIT_LEVEL=moderate pnpm run audit:all
```

## Release Gate

For an official release, `pnpm run audit:prod` should pass. A failing production audit blocks release unless the finding is documented, accepted, and clearly not reachable in the deployed demo path.

`pnpm run audit:all` is a manual release review step. Development-only findings in toolchains such as Hardhat, SvelteKit, Vite, test runners, or compiler helpers may be accepted for an alpha release when all of these are true:

- The vulnerable package is not shipped in runtime containers.
- The vulnerable path is only used by trusted maintainers during build, test, or contract compilation.
- There is no non-breaking upgrade available in the current dependency graph.
- The risk is tracked in release notes or this document before tagging.

## Current Scope

The production audit covers runtime dependencies in these workspace packages:

- `backend`
- `frontend-svelte`
- `blockchain`

The legacy Next.js `frontend` package remains in the workspace while migration finishes, but it is deprecated in favor of `frontend-svelte` and is not part of the official production runtime gate.

The full audit additionally covers legacy packages, developer tooling, and build systems. Findings there should be reviewed, but not automatically treated as production exposure.

## Current Findings

As of the latest local audit, these high-severity findings required a release decision:

| Package | Path | Status | Decision |
| --- | --- | --- | --- |
| `next` | `frontend > next` | Accepted for prod gate | Ignored by `audit:prod` because the Next.js frontend is deprecated and not deployed as the official runtime. Still visible in `audit:all`. |
| `multer` | `backend > @nestjs/platform-express > multer` | Remediated | Forced to `2.2.0` with a pnpm override until upstream NestJS ships the patched version. |

New high-severity production findings block an official release until remediated or explicitly accepted with a narrower deployment justification.

`pnpm run audit:all` still reports high-severity findings in development tooling:

| Package | Path | Status | Decision |
| --- | --- | --- | --- |
| `minimatch` | backend ESLint / TypeScript ESLint tooling | Open dev-only | Review before release; not shipped in runtime containers. |
| `serialize-javascript` | blockchain Hardhat / Mocha tooling | Open dev-only | Review before release; only used by trusted maintainers during contract tests/compilation. |
| `lodash-es` | blockchain Hardhat Ignition tooling | Open dev-only | Review before release; only used by trusted maintainers during contract deployment tooling. |

## Remediation Order

1. Prefer lockfile-compatible upgrades.
2. Prefer direct dependency upgrades over overrides.
3. Use `pnpm overrides` only when the transitive package is known compatible and tests pass.
4. Document accepted risks with package name, severity, affected path, and release decision.
