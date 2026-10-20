# Ernest console image. Build from the repository root (compose and the infra do):
#   docker build -f frontend/Dockerfile .
# The console is a standalone npm project; @chestertown/design comes from the vendored
# tarball in frontend/vendor, so the build needs nothing else from the repository.
FROM node:24-alpine AS builder

# Vite fixes these at build time (envPrefix PUBLIC_, see frontend/vite.config.ts).
ARG PUBLIC_API_URL=
ARG PUBLIC_ERNEST_API_KEY=
ARG PUBLIC_OIDC_ISSUER=
ARG PUBLIC_OIDC_CLIENT_ID=
ARG PUBLIC_OIDC_SCOPE="openid profile email"
ARG PUBLIC_OIDC_AUDIENCE=
ARG PUBLIC_AOS_URL=
ARG PUBLIC_PRUDENCE_URL=
ARG PUBLIC_ERNEST_URL=
ENV PUBLIC_API_URL=${PUBLIC_API_URL} \
    PUBLIC_ERNEST_API_KEY=${PUBLIC_ERNEST_API_KEY} \
    PUBLIC_OIDC_ISSUER=${PUBLIC_OIDC_ISSUER} \
    PUBLIC_OIDC_CLIENT_ID=${PUBLIC_OIDC_CLIENT_ID} \
    PUBLIC_OIDC_SCOPE=${PUBLIC_OIDC_SCOPE} \
    PUBLIC_OIDC_AUDIENCE=${PUBLIC_OIDC_AUDIENCE} \
    PUBLIC_AOS_URL=${PUBLIC_AOS_URL} \
    PUBLIC_PRUDENCE_URL=${PUBLIC_PRUDENCE_URL} \
    PUBLIC_ERNEST_URL=${PUBLIC_ERNEST_URL}

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/vendor ./vendor
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 3000
