# Ernest console (React)

The Ernest web console — the *assure* vertex of Chestertown — rebuilt in React 19 + Vite +
TypeScript on the shared design system `@chestertown/design` (vendored in `vendor/`). It
replaces the SvelteKit console in `../frontend-svelte`, screen by screen; until the switch-over
both exist and the deployment still builds the Svelte one.

| Screen | Status |
|---|---|
| Overview (`/`), sign-in (`/login`, `/auth/callback`), `/stats` redirect | ported |
| Models, Blocks, Events | ported |
| Verify receipt, Audit, Connectors | next |
| Tokens, Demo | later |

## Run locally

```bash
npm ci
PUBLIC_API_URL=http://127.0.0.1:3001 npm run dev    # http://localhost:5186
```

Configuration keeps the Svelte console's build-time variables (`envPrefix: "PUBLIC_"`):
`PUBLIC_API_URL`, `PUBLIC_ERNEST_API_KEY`, `PUBLIC_OIDC_*`, and `PUBLIC_AOS_URL`,
`PUBLIC_PRUDENCE_URL`, `PUBLIC_ERNEST_URL` for the module switcher. The backend's
`CORS_ORIGIN` must include the dev server's origin.
