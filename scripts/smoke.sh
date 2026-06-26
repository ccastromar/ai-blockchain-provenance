#!/usr/bin/env bash
set -euo pipefail

API_BASE="${ERNEST_API_BASE:-http://localhost:3001/api}"
HEALTH_URL="${ERNEST_HEALTH_URL:-http://localhost:3001/health}"
ERNEST_API_KEY="${ERNEST_API_KEY:-}"
RUN_ID="$(date +%s)"
MODEL_ID="smoke-model-${RUN_ID}"
INFERENCE_ID="smoke-inference-${RUN_ID}"

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

MODEL_HASH="$(hash_sha256 "${MODEL_ID}")"
INPUT_HASH="$(hash_sha256 "${MODEL_ID}:input")"
OUTPUT_HASH="$(hash_sha256 "${MODEL_ID}:output")"
GIT_COMMIT="$(hash_sha1 "${MODEL_ID}")"

AUTH_HEADERS=()
if [ -n "${ERNEST_API_KEY}" ]; then
  AUTH_HEADERS=(-H "X-Ernest-Api-Key: ${ERNEST_API_KEY}")
fi

echo "Checking health..."
curl --fail --silent --show-error "${HEALTH_URL}" >/dev/null

echo "Registering model ${MODEL_ID}..."
curl --fail --silent --show-error \
  -X POST "${API_BASE}/models" \
  "${AUTH_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{
    \"modelId\": \"${MODEL_ID}\",
    \"modelName\": \"Smoke Test Model\",
    \"version\": \"0.0.1\",
    \"mlflow\": {
      \"modelHash\": \"${MODEL_HASH}\",
      \"gitCommit\": \"${GIT_COMMIT}\"
    },
    \"params\": {
      \"model_type\": \"smoke\"
    },
    \"metrics\": {
      \"accuracy\": 1
    },
    \"metadata\": {
      \"source\": \"scripts/smoke.sh\"
    }
  }" >/dev/null

echo "Logging inference ${INFERENCE_ID}..."
curl --fail --silent --show-error \
  -X POST "${API_BASE}/inferences" \
  "${AUTH_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{
    \"modelId\": \"${MODEL_ID}\",
    \"inferenceId\": \"${INFERENCE_ID}\",
    \"inputHash\": \"${INPUT_HASH}\",
    \"outputHash\": \"${OUTPUT_HASH}\",
    \"params\": {
      \"return_probs\": false
    },
    \"metadata\": {
      \"source\": \"scripts/smoke.sh\"
    }
  }" >/dev/null

echo "Verifying chain..."
curl --fail --silent --show-error "${API_BASE}/verify"
echo

echo "Fetching stats..."
curl --fail --silent --show-error "${API_BASE}/stats"
echo

echo "Smoke test completed for ${MODEL_ID}."
