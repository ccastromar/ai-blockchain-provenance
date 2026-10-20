# Ernest console (React)

The Ernest web console — the *assure* vertex of Chestertown — in React 19 + Vite + TypeScript,
built on the shared design system `@chestertown/design` (vendored in `vendor/`). It replaced the
SvelteKit console with the same screens, URLs and build variables.

Screens: Overview, Models (`?model=<id>` deep links from Prudence and AOS), Blocks, Events,
Connectors, Audit, Verify receipt (merkle-wasm, in the browser), Tokens and Demo, plus sign-in
(`/login`, `/auth/callback`).

## Run locally

```bash
npm ci
PUBLIC_API_URL=http://127.0.0.1:3001 npm run dev    # http://localhost:5186
```

Configuration keeps the Svelte console's build-time variables (`envPrefix: "PUBLIC_"`):
`PUBLIC_API_URL`, `PUBLIC_ERNEST_API_KEY`, `PUBLIC_OIDC_*`, and `PUBLIC_AOS_URL`,
`PUBLIC_PRUDENCE_URL`, `PUBLIC_ERNEST_URL` for the module switcher. The backend's
`CORS_ORIGIN` must include the dev server's origin.

## Build and deploy

`Dockerfile` builds from the repository root (`docker build -f frontend/Dockerfile .`) and serves
`dist/` with nginx on port 3000, proxying `/api/` to the backend and `/ingestor/` to the optional
event-ingestor. The `PUBLIC_*` values are build arguments.

To upgrade the design system, run `scripts/release-local.sh` in the `chestertown-design`
repository and commit `vendor/`, `package.json` and `package-lock.json`.
