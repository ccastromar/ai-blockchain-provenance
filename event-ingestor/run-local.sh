#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/backups/ernest-ingestor.local.env"
MODE="${1:-}"
if [[ "${MODE}" != "serve" && "${MODE}" != "worker" ]]; then echo "Usage: $0 <serve|worker>" >&2; exit 2; fi
if [[ ! -f "${CONFIG_FILE}" ]]; then echo "Local ingestor config not found: ${CONFIG_FILE}" >&2; exit 1; fi
set -a
source "${CONFIG_FILE}"
set +a
if [[ "${MODE}" == "worker" ]]; then export METRICS_PORT=9103; fi
cd "${ROOT_DIR}/event-ingestor"
exec go run ./cmd/event-ingestor "${MODE}"
