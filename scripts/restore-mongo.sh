#!/usr/bin/env bash
set -euo pipefail

# Restores an Ernest MongoDB backup produced by scripts/backup-mongo.sh.
# DESTRUCTIVE: drops the target database before restoring. See docs/backup-recovery.md.

CONTAINER="${MONGO_CONTAINER:-ernest-mongodb}"
DB_NAME="${MONGO_DB_NAME:-ernest}"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-file.archive.gz>" >&2
  echo "Looks for the file as given, or inside ${BACKUP_DIR}." >&2
  if [[ -d "${BACKUP_DIR}" ]]; then
    echo "Available backups:" >&2
    ls -1 "${BACKUP_DIR}" 2>/dev/null | sed 's/^/  /' >&2
  fi
  exit 1
fi

ARCHIVE_PATH="$1"
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  ARCHIVE_PATH="${BACKUP_DIR}/$1"
fi
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Backup file not found: $1" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "Container '${CONTAINER}' is not running. Set MONGO_CONTAINER to override." >&2
  exit 1
fi

echo "This will DROP and REPLACE the '${DB_NAME}' database in container '${CONTAINER}'"
echo "with the contents of: ${ARCHIVE_PATH}"
read -r -p "Type the database name (${DB_NAME}) to confirm: " CONFIRM
if [[ "${CONFIRM}" != "${DB_NAME}" ]]; then
  echo "Confirmation did not match. Aborting." >&2
  exit 1
fi

docker exec -i "${CONTAINER}" mongorestore --archive --gzip --drop < "${ARCHIVE_PATH}"

echo
echo "Restore complete. A restore lands the chain in whatever state it was in at"
echo "backup time — verify it before trusting it:"
echo "  curl -s http://localhost:3001/health | python3 -m json.tool"
echo "  curl -s http://localhost:3001/api/verify | python3 -m json.tool"
