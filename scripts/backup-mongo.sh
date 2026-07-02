#!/usr/bin/env bash
set -euo pipefail

# Backs up the Ernest MongoDB database to a single gzip-compressed archive.
# The optional Ethereum anchor only proves a Merkle root existed at a point in
# time — it does not let you reconstruct block contents. This is what actually
# protects the evidence itself. See docs/backup-recovery.md.

CONTAINER="${MONGO_CONTAINER:-ernest-mongodb}"
DB_NAME="${MONGO_DB_NAME:-ernest}"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="ernest-${DB_NAME}-${TIMESTAMP}.archive.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "Container '${CONTAINER}' is not running. Set MONGO_CONTAINER to override." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "Backing up database '${DB_NAME}' from container '${CONTAINER}'..."
docker exec "${CONTAINER}" mongodump --db "${DB_NAME}" --archive --gzip > "${ARCHIVE_PATH}"

SIZE="$(du -h "${ARCHIVE_PATH}" | cut -f1)"
echo "Backup written: ${ARCHIVE_PATH} (${SIZE})"
echo "Restore with: ./scripts/restore-mongo.sh ${ARCHIVE_NAME}"
