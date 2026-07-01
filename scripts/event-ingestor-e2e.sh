#!/usr/bin/env bash
set -euo pipefail

EVENT_API_BASE="${EVENT_API_BASE:-http://localhost:3011}"
ERNEST_API_BASE="${ERNEST_API_BASE:-http://localhost:3001/api}"
EVENT_COUNT="${EVENT_COUNT:-5}"
RUN_ID="$(date +%Y%m%d%H%M%S)"
MODEL_ID="${MODEL_ID:-random-event-model-${RUN_ID}}"

compose() {
  if [[ -f .env ]]; then
    docker compose --env-file .env "$@"
  else
    docker compose "$@"
  fi
}

hash_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | openssl dgst -sha256 -r | awk '{print $1}'
  fi
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"

  for _ in $(seq 1 "${attempts}"); do
    if curl --fail --silent --show-error "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "${name} did not become ready at ${url}" >&2
  return 1
}

json_get_total_blocks() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("totalBlocks", 0))'
}

echo "Starting Ernest event-ingestor E2E stack..."
compose up -d --build mongodb redis backend event-ingestor event-writer

wait_for_url "http://localhost:3001/health" "backend"
wait_for_url "http://localhost:3011/health" "event-ingestor"

echo "Emitting ${EVENT_COUNT} random events for model ${MODEL_ID}..."
for i in $(seq 1 "${EVENT_COUNT}"); do
  EVENT_ID="random-${RUN_ID}-${i}"
  ARTIFACT_HASH="$(hash_sha256 "${MODEL_ID}:${EVENT_ID}:artifact")"
  SCORE="$(awk -v seed="${i}" 'BEGIN { srand(seed); printf "%.4f", rand() }')"

  curl --fail --silent --show-error \
    -X POST "${EVENT_API_BASE}/events" \
    -H "Content-Type: application/json" \
    -H "X-Ernest-Event-Source: random-local-emitter" \
    -H "X-Ernest-Event-Type: model.version.created" \
    -H "X-Ernest-Source-Event-Id: ${EVENT_ID}" \
    -d "{
      \"modelId\": \"${MODEL_ID}\",
      \"sourceEventId\": \"${EVENT_ID}\",
      \"version\": \"${i}\",
      \"artifactHash\": \"${ARTIFACT_HASH}\",
      \"metrics\": {
        \"random_score\": ${SCORE}
      },
      \"metadata\": {
        \"emitter\": \"scripts/event-ingestor-e2e.sh\",
        \"runId\": \"${RUN_ID}\"
      }
    }" >/dev/null

  echo "  accepted ${EVENT_ID}"
done

echo "Waiting for event-writer to append blocks..."
for _ in $(seq 1 30); do
  PROVENANCE="$(curl --fail --silent --show-error "${ERNEST_API_BASE}/provenances/${MODEL_ID}" || true)"
  TOTAL_BLOCKS="$(printf '%s' "${PROVENANCE}" | json_get_total_blocks 2>/dev/null || printf '0')"
  if [[ "${TOTAL_BLOCKS}" -ge "${EVENT_COUNT}" ]]; then
    break
  fi
  sleep 1
done

PROVENANCE="$(curl --fail --silent --show-error "${ERNEST_API_BASE}/provenances/${MODEL_ID}")"
TOTAL_BLOCKS="$(printf '%s' "${PROVENANCE}" | json_get_total_blocks)"

if [[ "${TOTAL_BLOCKS}" -lt "${EVENT_COUNT}" ]]; then
  echo "Expected at least ${EVENT_COUNT} provenance blocks for ${MODEL_ID}, got ${TOTAL_BLOCKS}" >&2
  echo "${PROVENANCE}" >&2
  exit 1
fi

echo "Verifying hashchain..."
VERIFY="$(curl --fail --silent --show-error "${ERNEST_API_BASE}/verify")"
echo "${VERIFY}"

echo
echo "Event ingestion E2E complete."
echo "Model ID: ${MODEL_ID}"
echo "Provenance: ${ERNEST_API_BASE}/provenances/${MODEL_ID}"
echo "Events emitted: ${EVENT_COUNT}"
