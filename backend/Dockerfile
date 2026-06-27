FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /repo

RUN corepack enable

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY blockchain/package.json ./blockchain/package.json
COPY frontend/package.json ./frontend/package.json
COPY frontend-svelte/package.json ./frontend-svelte/package.json
RUN pnpm install --filter ernest-backend... --frozen-lockfile

COPY backend ./backend
RUN pnpm --filter ernest-backend build

FROM base AS runner

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY blockchain/package.json ./blockchain/package.json
COPY frontend/package.json ./frontend/package.json
COPY frontend-svelte/package.json ./frontend-svelte/package.json
RUN pnpm install --filter ernest-backend --prod --frozen-lockfile && pnpm store prune

COPY --from=builder --chown=node:node /repo/backend/dist ./backend/dist

EXPOSE 3001

USER node

CMD ["pnpm", "--filter", "ernest-backend", "start:prod"]
