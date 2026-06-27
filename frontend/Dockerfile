FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /repo

RUN corepack enable

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --filter ernest-frontend... --frozen-lockfile

COPY frontend ./frontend
RUN pnpm --filter ernest-frontend build

FROM base AS runner

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --filter ernest-frontend --prod --frozen-lockfile && pnpm store prune

COPY --from=builder --chown=node:node /repo/frontend/next.config.js ./frontend/next.config.js
COPY --from=builder --chown=node:node /repo/frontend/.next ./frontend/.next

EXPOSE 3000

USER node

CMD ["pnpm", "--filter", "ernest-frontend", "start"]
