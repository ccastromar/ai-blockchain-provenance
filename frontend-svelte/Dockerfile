FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /repo

RUN corepack enable

FROM base AS builder

ARG PUBLIC_API_URL=http://localhost:3001
ARG PUBLIC_ERNEST_API_KEY=
ARG PUBLIC_OIDC_ISSUER=
ARG PUBLIC_OIDC_CLIENT_ID=
ARG PUBLIC_OIDC_SCOPE=openid profile email

ENV PUBLIC_API_URL=${PUBLIC_API_URL}
ENV PUBLIC_ERNEST_API_KEY=${PUBLIC_ERNEST_API_KEY}
ENV PUBLIC_OIDC_ISSUER=${PUBLIC_OIDC_ISSUER}
ENV PUBLIC_OIDC_CLIENT_ID=${PUBLIC_OIDC_CLIENT_ID}
ENV PUBLIC_OIDC_SCOPE=${PUBLIC_OIDC_SCOPE}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY blockchain/package.json ./blockchain/package.json
COPY frontend-svelte/package.json ./frontend-svelte/package.json
RUN pnpm install --filter ernest-frontend-svelte... --frozen-lockfile

COPY frontend-svelte ./frontend-svelte
RUN pnpm --filter ernest-frontend-svelte build

FROM nginx:1.27-alpine AS runner

COPY frontend-svelte/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/frontend-svelte/build /usr/share/nginx/html

EXPOSE 3000
