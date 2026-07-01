#!/usr/bin/env bash
set -euo pipefail

FRONTEND_BASE="${FRONTEND_BASE:-http://localhost:3000}"
API_BASE="${API_BASE:-${FRONTEND_BASE}/api}"
INGESTOR_BASE="${INGESTOR_BASE:-${FRONTEND_BASE}/ingestor}"
RUN_ID="$(date +%Y%m%d%H%M%S)"
HF_MODEL_ID="${HF_MODEL_ID:-openai-community/gpt2-e2e-${RUN_ID}}"
SM_MODEL_ID="${SM_MODEL_ID:-credit-risk-xgb-e2e-${RUN_ID}}"
INGEST_KEY="${EVENT_INGESTOR_API_KEY:-}"
HF_SECRET="${HF_WEBHOOK_SECRET:-}"
INGEST_HEADERS=()
if [[ -n "${INGEST_KEY}" ]]; then
  INGEST_HEADERS=(-H "X-Ernest-Ingest-Key: ${INGEST_KEY}")
fi
HF_HEADERS=()
if [[ -n "${HF_SECRET}" ]]; then
  HF_HEADERS=(-H "X-Webhook-Secret: ${HF_SECRET}")
fi

compose() {
  if [[ -f .env ]]; then
    docker compose --env-file .env "$@"
  else
    docker compose "$@"
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

json_field() {
  local field="$1"
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get(sys.argv[1], ""))' "${field}"
}

json_is_valid_chain() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print("true" if data.get("isValid") is True else "false")'
}

wait_for_appended_event() {
  local source="$1"
  local source_event_id="$2"
  local attempts="${3:-45}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    response="$(curl --fail --silent --show-error "${API_BASE}/ingested-events?source=${source}&limit=20")"
    if printf '%s' "${response}" | python3 -c 'import json,sys; needle=sys.argv[1]; data=json.load(sys.stdin); items=data.get("items", []); sys.exit(0 if any(item.get("sourceEventId") == needle and item.get("status") == "appended" for item in items) else 1)' "${source_event_id}"
    then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for appended event ${source_event_id}" >&2
  return 1
}

wait_for_duplicate_event() {
  local source="$1"
  local source_event_id="$2"
  local attempts="${3:-45}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    response="$(curl --fail --silent --show-error "${API_BASE}/ingested-events?source=${source}&status=duplicate&limit=20")"
    if printf '%s' "${response}" | python3 -c 'import json,sys; needle=sys.argv[1]; data=json.load(sys.stdin); items=data.get("items", []); sys.exit(0 if any(item.get("sourceEventId") == needle and int(item.get("duplicateCount") or 0) >= 1 for item in items) else 1)' "${source_event_id}"
    then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for duplicate event ${source_event_id}" >&2
  return 1
}

wait_for_event_verification() {
  local source="$1"
  local source_event_id="$2"
  local expected_verification="$3"
  local attempts="${4:-45}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    response="$(curl --fail --silent --show-error "${API_BASE}/ingested-events?source=${source}&verificationStatus=${expected_verification}&limit=20")"
    if printf '%s' "${response}" | python3 -c 'import json,sys; needle=sys.argv[1]; expected=sys.argv[2]; data=json.load(sys.stdin); items=data.get("items", []); sys.exit(0 if any(item.get("sourceEventId") == needle and item.get("verificationStatus") == expected for item in items) else 1)' "${source_event_id}" "${expected_verification}"
    then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for ${source_event_id} verification ${expected_verification}" >&2
  return 1
}

wait_for_failure_kind() {
  local failure_kind="$1"
  local expected_min="$2"
  local attempts="${3:-45}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    response="$(curl --fail --silent --show-error "${API_BASE}/ingested-events/failures/stats")"
    if printf '%s' "${response}" | python3 -c 'import json,sys; kind=sys.argv[1]; expected=int(sys.argv[2]); data=json.load(sys.stdin); count=int((data.get("byFailureKind") or {}).get(kind) or 0); sys.exit(0 if count >= expected else 1)' "${failure_kind}" "${expected_min}"
    then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for failure kind ${failure_kind} >= ${expected_min}" >&2
  return 1
}

wait_for_ingestor_health_count() {
  local path="$1"
  local expected_min="$2"
  local attempts="${3:-45}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    response="$(curl --fail --silent --show-error "${API_BASE}/ingestor/health")"
    if printf '%s' "${response}" | python3 -c 'import json,sys; path=sys.argv[1].split("."); expected=int(sys.argv[2]); data=json.load(sys.stdin); value=data;
for key in path:
    value = (value or {}).get(key)
count=int(value or 0)
sys.exit(0 if count >= expected else 1)' "${path}" "${expected_min}"
    then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for ingestor health ${path} >= ${expected_min}" >&2
  return 1
}

assert_provenance() {
  local model_id="$1"
  local expected_min_blocks="$2"

  local response
  response="$(curl --fail --silent --show-error "${API_BASE}/provenances?modelId=${model_id}")"
  local total
  total="$(printf '%s' "${response}" | json_field totalBlocks)"
  if [[ "${total}" -lt "${expected_min_blocks}" ]]; then
    echo "Expected at least ${expected_min_blocks} blocks for ${model_id}, got ${total}" >&2
    echo "${response}" >&2
    return 1
  fi
}

assert_provenance_exact() {
  local model_id="$1"
  local expected_blocks="$2"

  local response
  response="$(curl --fail --silent --show-error "${API_BASE}/provenances?modelId=${model_id}")"
  local total
  total="$(printf '%s' "${response}" | json_field totalBlocks)"
  if [[ "${total}" -ne "${expected_blocks}" ]]; then
    echo "Expected exactly ${expected_blocks} blocks for ${model_id}, got ${total}" >&2
    echo "${response}" >&2
    return 1
  fi
}

echo "Starting Ernest connector E2E stack..."
compose up -d --build mongodb redis backend event-ingestor event-writer frontend

wait_for_url "${FRONTEND_BASE}/health" "frontend"
wait_for_url "${API_BASE}/verify" "backend API"
wait_for_url "${INGESTOR_BASE}/health" "event-ingestor proxy"

echo "Checking ingestor health endpoint..."
HEALTH_STATUS="$(curl --fail --silent --show-error "${API_BASE}/ingestor/health" | json_field status)"
if [[ "${HEALTH_STATUS}" != "healthy" ]]; then
  echo "Expected ingestor health status healthy, got ${HEALTH_STATUS}" >&2
  exit 1
fi

if [[ -n "${INGEST_KEY}" ]]; then
  echo "Checking backend reports shared-secret ingestor auth..."
  AUTH_MODE="$(curl --fail --silent --show-error "${API_BASE}/ingestor/auth" | json_field mode)"
  if [[ "${AUTH_MODE}" != "shared_secret" ]]; then
    echo "Expected backend ingestor auth mode shared_secret, got ${AUTH_MODE}" >&2
    exit 1
  fi

  echo "Checking ingestor auth rejects requests without the shared secret..."
  AUTH_STATUS="$(curl --silent --output /dev/null --write-out "%{http_code}" \
    -X POST "${INGESTOR_BASE}/events/sagemaker" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"evt-auth-negative-${RUN_ID}\",\"source\":\"aws.sagemaker\",\"detail-type\":\"SageMaker Model Package State Change\",\"detail\":{}}")"
  if [[ "${AUTH_STATUS}" != "401" ]]; then
    echo "Expected unauthenticated ingestor request to return 401, got ${AUTH_STATUS}" >&2
    exit 1
  fi
fi

if [[ -n "${HF_SECRET}" ]]; then
  echo "Checking Hugging Face webhook secret rejects unsigned provider events..."
  HF_AUTH_STATUS="$(curl --silent --output /dev/null --write-out "%{http_code}" \
    -X POST "${INGESTOR_BASE}/events/huggingface" \
    -H "Content-Type: application/json" \
    "${INGEST_HEADERS[@]}" \
    -d "{\"event\":{\"action\":\"update\",\"scope\":\"repo.content\"},\"repo\":{\"type\":\"model\",\"name\":\"${HF_MODEL_ID}\",\"headSha\":\"${RUN_ID}\"},\"webhook\":{\"id\":\"e2e-hf-webhook\"}}")"
  if [[ "${HF_AUTH_STATUS}" != "401" ]]; then
    echo "Expected Hugging Face event without provider secret to return 401, got ${HF_AUTH_STATUS}" >&2
    exit 1
  fi
fi

echo "Checking backend ingestor proxy simulation..."
PROXY_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/sagemaker" \
  -H "Content-Type: application/json")"
PROXY_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_SOURCE_EVENT_ID}"

if [[ -n "${INGEST_KEY}" || -n "${HF_SECRET}" ]]; then
  EXPECTED_AUTH_REJECTIONS=0
  if [[ -n "${INGEST_KEY}" ]]; then
    EXPECTED_AUTH_REJECTIONS=$((EXPECTED_AUTH_REJECTIONS + 1))
  fi
  if [[ -n "${HF_SECRET}" ]]; then
    EXPECTED_AUTH_REJECTIONS=$((EXPECTED_AUTH_REJECTIONS + 1))
  fi
  echo "Checking auth rejections are visible in failure stats..."
  wait_for_failure_kind "auth_rejected" "${EXPECTED_AUTH_REJECTIONS}"
  wait_for_ingestor_health_count "failureStats.byFailureKind.auth_rejected" "${EXPECTED_AUTH_REJECTIONS}"
fi

if [[ -n "${HF_SECRET}" ]]; then
  echo "Checking backend Hugging Face proxy simulation with provider secret..."
  PROXY_HF_RESPONSE="$(curl --fail --silent --show-error \
    -X POST "${API_BASE}/ingestor/simulate/huggingface" \
    -H "Content-Type: application/json")"
  PROXY_HF_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_HF_RESPONSE}" | json_field sourceEventId)"
  PROXY_HF_VERIFICATION="$(printf '%s' "${PROXY_HF_RESPONSE}" | json_field verificationStatus)"
  if [[ "${PROXY_HF_VERIFICATION}" != "provider_secret" ]]; then
    echo "Expected proxied Hugging Face verification provider_secret, got ${PROXY_HF_VERIFICATION}" >&2
    echo "${PROXY_HF_RESPONSE}" >&2
    exit 1
  fi
  echo "  proxied ${PROXY_HF_SOURCE_EVENT_ID}"
fi

echo "Emitting Hugging Face webhook event..."
HF_SHA="${RUN_ID}abcdefabcdefabcdefabcdefabcdefabcdef"
HF_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/huggingface" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  "${HF_HEADERS[@]}" \
  -d "{
    \"event\": { \"action\": \"update\", \"scope\": \"repo.content\" },
    \"repo\": {
      \"type\": \"model\",
      \"name\": \"${HF_MODEL_ID}\",
      \"headSha\": \"${HF_SHA}\",
      \"url\": {
        \"web\": \"https://huggingface.co/${HF_MODEL_ID}\",
        \"api\": \"https://huggingface.co/api/models/${HF_MODEL_ID}\"
      }
    },
    \"webhook\": { \"id\": \"e2e-hf-webhook\" }
  }")"
HF_SOURCE_EVENT_ID="$(printf '%s' "${HF_RESPONSE}" | json_field sourceEventId)"
HF_VERIFICATION="$(printf '%s' "${HF_RESPONSE}" | json_field verificationStatus)"
if [[ -n "${HF_SECRET}" && "${HF_VERIFICATION}" != "provider_secret" ]]; then
  echo "Expected Hugging Face verification provider_secret, got ${HF_VERIFICATION}" >&2
  echo "${HF_RESPONSE}" >&2
  exit 1
fi
echo "  accepted ${HF_SOURCE_EVENT_ID}"

echo "Emitting SageMaker EventBridge event..."
SM_VERSION="$(date +%s)"
SM_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/sagemaker" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"id\": \"evt-e2e-sm-${RUN_ID}\",
    \"source\": \"aws.sagemaker\",
    \"detail-type\": \"SageMaker Model Package State Change\",
    \"account\": \"123456789012\",
    \"region\": \"eu-west-1\",
    \"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"detail\": {
      \"ModelPackageGroupName\": \"${SM_MODEL_ID}\",
      \"ModelPackageVersion\": \"${SM_VERSION}\",
      \"ModelApprovalStatus\": \"Approved\",
      \"ModelPackageArn\": \"arn:aws:sagemaker:eu-west-1:123456789012:model-package/${SM_MODEL_ID}/${SM_VERSION}\",
      \"ModelDataUrl\": \"s3://ernest-models/${SM_MODEL_ID}/${SM_VERSION}/model.tar.gz\",
      \"ModelArtifactHash\": \"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"
    }
  }")"
SM_SOURCE_EVENT_ID="$(printf '%s' "${SM_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${SM_SOURCE_EVENT_ID}"

echo "Waiting for writer to append connector events..."
wait_for_appended_event "sagemaker" "${PROXY_SOURCE_EVENT_ID}"
wait_for_event_verification "sagemaker" "${PROXY_SOURCE_EVENT_ID}" "shared_secret"
if [[ -n "${HF_SECRET}" ]]; then
  wait_for_appended_event "huggingface" "${PROXY_HF_SOURCE_EVENT_ID}"
  wait_for_event_verification "huggingface" "${PROXY_HF_SOURCE_EVENT_ID}" "provider_secret"
fi
wait_for_appended_event "huggingface" "${HF_SOURCE_EVENT_ID}"
if [[ -n "${HF_SECRET}" ]]; then
  wait_for_event_verification "huggingface" "${HF_SOURCE_EVENT_ID}" "provider_secret"
  wait_for_ingestor_health_count "stats.byVerificationStatus.provider_secret" 1
fi
wait_for_appended_event "sagemaker" "${SM_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "sagemaker" "${SM_SOURCE_EVENT_ID}" "shared_secret"
fi

echo "Re-emitting Hugging Face event to verify idempotency..."
curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/huggingface" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  "${HF_HEADERS[@]}" \
  -d "{
    \"event\": { \"action\": \"update\", \"scope\": \"repo.content\" },
    \"repo\": {
      \"type\": \"model\",
      \"name\": \"${HF_MODEL_ID}\",
      \"headSha\": \"${HF_SHA}\",
      \"url\": {
        \"web\": \"https://huggingface.co/${HF_MODEL_ID}\",
        \"api\": \"https://huggingface.co/api/models/${HF_MODEL_ID}\"
      }
    },
    \"webhook\": { \"id\": \"e2e-hf-webhook\" }
  }" >/dev/null
wait_for_duplicate_event "huggingface" "${HF_SOURCE_EVENT_ID}"

echo "Checking provenance..."
assert_provenance_exact "${HF_MODEL_ID}" 1
assert_provenance "${SM_MODEL_ID}" 1

echo "Checking dead-letter visibility endpoint..."
curl --fail --silent --show-error "${API_BASE}/ingested-events/failures/stats" >/dev/null

echo "Verifying hashchain..."
VERIFY="$(curl --fail --silent --show-error "${API_BASE}/verify")"
if [[ "$(printf '%s' "${VERIFY}" | json_is_valid_chain)" != "true" ]]; then
  echo "Hashchain verification failed:" >&2
  echo "${VERIFY}" >&2
  exit 1
fi

echo
echo "Connector E2E complete."
echo "Hugging Face model: ${HF_MODEL_ID}"
echo "SageMaker model: ${SM_MODEL_ID}"
echo "Events: ${FRONTEND_BASE}/events"
echo "Connectors: ${FRONTEND_BASE}/connectors"
