#!/usr/bin/env bash
set -euo pipefail

API_ORIGIN="${ERNEST_API_ORIGIN:-http://localhost:3001}"
API_BASE="${API_ORIGIN%/}/api"
HEALTH_URL="${ERNEST_HEALTH_URL:-${API_ORIGIN%/}/health}"
ERNEST_API_KEY="${ERNEST_API_KEY:-}"
RUN_ID="$(date +%s)"
MODEL_ID="deploy-check-model-${RUN_ID}"

hash_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | openssl dgst -sha256 -r | awk '{print $1}'
  fi
}

hash_sha1() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum | awk '{print $1}'
  elif command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha1sum | awk '{print $1}'
  else
    printf '%s' "$1" | openssl dgst -sha1 -r | awk '{print $1}'
  fi
}

AUTH_HEADERS=()
if [ -n "${ERNEST_API_KEY}" ]; then
  AUTH_HEADERS=(-H "X-Ernest-Api-Key: ${ERNEST_API_KEY}")
fi

echo "Checking health at ${HEALTH_URL}..."
curl --fail --silent --show-error "${HEALTH_URL}" >/dev/null

echo "Checking OpenAPI JSON..."
curl --fail --silent --show-error "${API_ORIGIN%/}/api/docs-json" >/dev/null

echo "Checking chain stats..."
curl --fail --silent --show-error "${AUTH_HEADERS[@]+"${AUTH_HEADERS[@]}"}" "${API_BASE}/stats" >/dev/null

if [ -z "${ERNEST_API_KEY}" ]; then
  echo "ERNEST_API_KEY is not set; skipping write check."
  echo "Deploy check completed."
  exit 0
fi

MODEL_HASH="$(hash_sha256 "${MODEL_ID}")"
GIT_COMMIT="$(hash_sha1 "${MODEL_ID}")"

echo "Checking protected model registration..."
curl --fail --silent --show-error \
  -X POST "${API_BASE}/models" \
  "${AUTH_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{
    \"modelId\": \"${MODEL_ID}\",
    \"modelName\": \"Deploy Check Model\",
    \"version\": \"0.0.1\",
    \"mlflow\": {
      \"modelHash\": \"${MODEL_HASH}\",
      \"gitCommit\": \"${GIT_COMMIT}\"
    },
    \"metadata\": {
      \"source\": \"scripts/deploy-check.sh\"
    }
  }" >/dev/null

echo "Deploy check completed for ${MODEL_ID}."
