# VPS Deployment Guide

This guide targets a small single-node demo server, for example 2 GB RAM and 50 GB disk. It is suitable for a public PoC, not for regulated production workloads.

## Recommended Shape

- Docker Compose on one VPS.
- MongoDB, backend, and frontend on the private Docker network.
- Host ports bound to `127.0.0.1`.
- pnpm workspace lockfile for reproducible JavaScript container builds.
- Caddy or Nginx terminates HTTPS and proxies public traffic to the local frontend/backend ports.
- `ERNEST_API_KEY` enabled for all public demos.

## Minimum Server Setup

Install Docker Engine and the Docker Compose plugin, then clone the repository:

```bash
git clone https://github.com/ccastromar/ai-blockchain-provenance.git
cd ai-blockchain-provenance
cp .env.example .env
```

Set at least:

```bash
ERNEST_API_KEY=<long-random-secret>
CORS_ORIGIN=https://ernest.example.com
PUBLIC_API_URL=https://ernest.example.com
PUBLIC_ERNEST_API_KEY=<same-key-only-for-browser-demo>
```

For a browser-only demo, `PUBLIC_ERNEST_API_KEY` lets the frontend call protected write endpoints. It is public in the JavaScript bundle, so treat it as a demo convenience only. The SvelteKit frontend is a static image, so rebuild the frontend container after changing any `PUBLIC_*` value.

## Start

```bash
docker compose up -d --build
docker compose ps
```

Local checks on the VPS:

```bash
./scripts/deploy-check.sh
```

If the public URL is already routed:

```bash
ERNEST_API_ORIGIN=https://ernest.example.com ./scripts/deploy-check.sh
```

If `ERNEST_API_KEY` is exported in the shell, the check also registers a short-lived test model.

## Caddy Example

```caddyfile
ernest.example.com {
  reverse_proxy /api/* 127.0.0.1:3001
  reverse_proxy /health 127.0.0.1:3001
  reverse_proxy 127.0.0.1:3000
}
```

## Nginx Example

```nginx
server {
  listen 443 ssl http2;
  server_name ernest.example.com;

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /health {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Disk Management For 50 GB Servers

The compose file rotates container JSON logs at 3 files of 10 MB per service. Still, Docker images and Mongo backups can grow quickly.

Check usage:

```bash
docker system df
docker volume ls
du -sh backups 2>/dev/null || true
```

After confirming no important stopped containers or old images are needed:

```bash
docker image prune -f
docker builder prune -f
```

Avoid `docker system prune --volumes` unless you intentionally want to delete unused volumes. MongoDB data lives in the `mongodb_data` volume.

## MongoDB Backup And Restore

Create a compressed backup directory:

```bash
mkdir -p backups
docker compose exec -T mongodb mongodump --archive --gzip > "backups/ernest-$(date +%Y%m%d-%H%M%S).archive.gz"
```

Restore into the running MongoDB container:

```bash
docker compose exec -T mongodb mongorestore --archive --gzip --drop < backups/ernest.archive.gz
```

Keep only a small number of backups on a 50 GB server, and move important snapshots off the VPS.

## Update

```bash
git pull
docker compose up -d --build
./scripts/deploy-check.sh
```

## Public Demo Checklist

- `ERNEST_API_KEY` is set.
- `CORS_ORIGIN` is the final HTTPS origin.
- MongoDB is not exposed publicly.
- The reverse proxy serves HTTPS.
- `/api/docs` and `/api/docs-json` are reachable if you want public API docs.
- Sepolia private keys, if configured, use a low-fund demo wallet.
