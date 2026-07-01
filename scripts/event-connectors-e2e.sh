#!/usr/bin/env bash
set -euo pipefail

FRONTEND_BASE="${FRONTEND_BASE:-http://localhost:3000}"
API_BASE="${API_BASE:-${FRONTEND_BASE}/api}"
INGESTOR_BASE="${INGESTOR_BASE:-${FRONTEND_BASE}/ingestor}"
RUN_ID="$(date +%Y%m%d%H%M%S)"
HF_MODEL_ID="${HF_MODEL_ID:-openai-community/gpt2-e2e-${RUN_ID}}"
SM_MODEL_ID="${SM_MODEL_ID:-credit-risk-xgb-e2e-${RUN_ID}}"
AZ_MODEL_ID="${AZ_MODEL_ID:-credit-risk-azure-e2e-${RUN_ID}}"
CE_MODEL_ID="${CE_MODEL_ID:-credit-risk-cloudevents-e2e-${RUN_ID}}"
DBX_MODEL_ID="${DBX_MODEL_ID:-prod.ml_team.credit_risk_databricks_e2e_${RUN_ID}}"
OL_MODEL_ID="${OL_MODEL_ID:-credit-risk-openlineage-e2e-${RUN_ID}}"
OTEL_MODEL_ID="${OTEL_MODEL_ID:-credit-risk-otel-e2e-${RUN_ID}}"
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

echo "Checking backend OpenLineage proxy simulation..."
PROXY_OL_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/openlineage" \
  -H "Content-Type: application/json")"
PROXY_OL_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_OL_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_OL_SOURCE_EVENT_ID}"

echo "Checking backend Azure ML proxy simulation..."
PROXY_AZ_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/azureml" \
  -H "Content-Type: application/json")"
PROXY_AZ_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_AZ_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_AZ_SOURCE_EVENT_ID}"

echo "Checking backend CloudEvents proxy simulation..."
PROXY_CE_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/cloudevents" \
  -H "Content-Type: application/json")"
PROXY_CE_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_CE_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_CE_SOURCE_EVENT_ID}"

echo "Checking backend Databricks proxy simulation..."
PROXY_DBX_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/databricks" \
  -H "Content-Type: application/json")"
PROXY_DBX_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_DBX_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_DBX_SOURCE_EVENT_ID}"

echo "Checking backend OpenTelemetry proxy simulation..."
PROXY_OTEL_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${API_BASE}/ingestor/simulate/opentelemetry" \
  -H "Content-Type: application/json")"
PROXY_OTEL_SOURCE_EVENT_ID="$(printf '%s' "${PROXY_OTEL_RESPONSE}" | json_field sourceEventId)"
echo "  proxied ${PROXY_OTEL_SOURCE_EVENT_ID}"

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

echo "Checking strict CloudEvents rejects invalid envelopes..."
CE_INVALID_STATUS="$(curl --silent --output /dev/null --write-out "%{http_code}" \
  -X POST "${INGESTOR_BASE}/events/cloudevents" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{\"specversion\":\"0.3\",\"id\":\"ce-invalid-${RUN_ID}\",\"source\":\"urn:ernest:e2e\",\"type\":\"com.ernest.model.registered\"}")"
if [[ "${CE_INVALID_STATUS}" != "400" ]]; then
  echo "Expected invalid CloudEvents envelope to return 400, got ${CE_INVALID_STATUS}" >&2
  exit 1
fi
wait_for_failure_kind "validation_rejected" 1

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

echo "Emitting Azure ML Event Grid event..."
AZ_VERSION="$(date +%s)"
AZ_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/azureml" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"id\": \"evt-e2e-az-${RUN_ID}\",
    \"eventType\": \"Microsoft.MachineLearningServices.ModelRegistered\",
    \"subject\": \"/workspaces/ernest-e2e/models/${AZ_MODEL_ID}/versions/${AZ_VERSION}\",
    \"eventTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"topic\": \"/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ernest/providers/Microsoft.MachineLearningServices/workspaces/ernest-e2e\",
    \"data\": {
      \"workspaceName\": \"ernest-e2e\",
      \"modelName\": \"${AZ_MODEL_ID}\",
      \"modelDisplayName\": \"Credit Risk Azure ML E2E\",
      \"modelVersion\": \"${AZ_VERSION}\",
      \"modelUri\": \"azureml://registries/ernest/models/${AZ_MODEL_ID}/versions/${AZ_VERSION}\",
      \"artifactHash\": \"abababababababababababababababababababababababababababababababab\",
      \"gitCommit\": \"${RUN_ID}\"
    }
  }")"
AZ_SOURCE_EVENT_ID="$(printf '%s' "${AZ_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${AZ_SOURCE_EVENT_ID}"

echo "Emitting strict CloudEvents event..."
CE_VERSION="$(date +%s)"
CE_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/cloudevents" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"specversion\": \"1.0\",
    \"id\": \"ce-e2e-${RUN_ID}\",
    \"source\": \"urn:ernest:e2e\",
    \"type\": \"com.ernest.model.registered\",
    \"subject\": \"models/${CE_MODEL_ID}/versions/${CE_VERSION}\",
    \"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"datacontenttype\": \"application/json\",
    \"data\": {
      \"eventType\": \"model.registered\",
      \"modelId\": \"${CE_MODEL_ID}\",
      \"modelName\": \"Credit Risk CloudEvents E2E\",
      \"version\": \"${CE_VERSION}\",
      \"artifactHash\": \"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\",
      \"gitCommit\": \"${RUN_ID}\"
    }
  }")"
CE_SOURCE_EVENT_ID="$(printf '%s' "${CE_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${CE_SOURCE_EVENT_ID}"

echo "Emitting Databricks Unity Catalog event..."
DBX_VERSION="$(date +%s)"
DBX_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/databricks" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"id\": \"dbx-e2e-${RUN_ID}\",
    \"eventType\": \"model.version.created\",
    \"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"workspaceId\": \"1234567890\",
    \"workspaceUrl\": \"https://ernest-demo.cloud.databricks.com\",
    \"data\": {
      \"full_name\": \"${DBX_MODEL_ID}\",
      \"version\": \"${DBX_VERSION}\",
      \"source\": \"dbfs:/models/${DBX_MODEL_ID}/${DBX_VERSION}\",
      \"artifactHash\": \"dbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdb\",
      \"run_id\": \"run-e2e-dbx-${RUN_ID}\",
      \"gitCommit\": \"${RUN_ID}\",
      \"metrics\": { \"auc\": 0.96 },
      \"inputs\": [
        { \"fullName\": \"prod.features.loan_features\" },
        { \"fullName\": \"prod.features.customer_features\" }
      ]
    }
  }")"
DBX_SOURCE_EVENT_ID="$(printf '%s' "${DBX_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${DBX_SOURCE_EVENT_ID}"

echo "Emitting OpenLineage run event..."
OL_VERSION="$(date +%s)"
OL_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/openlineage" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"eventType\": \"COMPLETE\",
    \"eventTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"run\": {
      \"runId\": \"run-e2e-ol-${RUN_ID}\",
      \"facets\": {
        \"ernest\": {
          \"modelId\": \"${OL_MODEL_ID}\",
          \"modelName\": \"Credit Risk OpenLineage E2E\",
          \"version\": \"${OL_VERSION}\",
          \"artifactHash\": \"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",
          \"metrics\": { \"auc\": 0.94 }
        },
        \"sourceCode\": { \"gitCommit\": \"${RUN_ID}\" }
      }
    },
    \"job\": {
      \"namespace\": \"ernest-e2e-training\",
      \"name\": \"credit-risk-openlineage-train\"
    },
    \"inputs\": [
      {
        \"namespace\": \"warehouse\",
        \"name\": \"credit-risk/features\",
        \"facets\": { \"version\": { \"version\": \"$(date -u +%Y-%m-%d)\" } }
      }
    ],
    \"outputs\": [
      {
        \"namespace\": \"model-registry\",
        \"name\": \"${OL_MODEL_ID}/${OL_VERSION}\",
        \"facets\": { \"ernest\": { \"hash\": \"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\" } }
      }
    ]
  }")"
OL_SOURCE_EVENT_ID="$(printf '%s' "${OL_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${OL_SOURCE_EVENT_ID}"

echo "Emitting OpenTelemetry OTLP log event..."
OTEL_INFERENCE_ID="inf-e2e-otel-${RUN_ID}"
OTEL_TRACE_ID="${RUN_ID}aaaaaaaaaaaaaaaaaaaaaaaa"
OTEL_SPAN_ID="${RUN_ID}bbbbbbbb"
OTEL_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "${INGESTOR_BASE}/events/opentelemetry/logs" \
  -H "Content-Type: application/json" \
  "${INGEST_HEADERS[@]}" \
  -d "{
    \"resourceLogs\": [
      {
        \"resource\": {
          \"attributes\": [
            { \"key\": \"service.name\", \"value\": { \"stringValue\": \"loan-decision-api\" } },
            { \"key\": \"ai.provider\", \"value\": { \"stringValue\": \"internal-ai-gateway\" } }
          ]
        },
        \"scopeLogs\": [
          {
            \"scope\": { \"name\": \"ernest-e2e-otel\" },
            \"logRecords\": [
              {
                \"timeUnixNano\": \"1782900000000000000\",
                \"traceId\": \"${OTEL_TRACE_ID}\",
                \"spanId\": \"${OTEL_SPAN_ID}\",
                \"body\": { \"stringValue\": \"AI inference completed\" },
                \"attributes\": [
                  { \"key\": \"ai.model.id\", \"value\": { \"stringValue\": \"${OTEL_MODEL_ID}\" } },
                  { \"key\": \"ai.model.version\", \"value\": { \"stringValue\": \"prod\" } },
                  { \"key\": \"ai.inference.id\", \"value\": { \"stringValue\": \"${OTEL_INFERENCE_ID}\" } },
                  { \"key\": \"ai.input.hash\", \"value\": { \"stringValue\": \"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\" } },
                  { \"key\": \"ai.output.hash\", \"value\": { \"stringValue\": \"1111111111111111111111111111111111111111111111111111111111111111\" } },
                  { \"key\": \"ai.operation\", \"value\": { \"stringValue\": \"loan_decision\" } }
                ]
              }
            ]
          }
        ]
      }
    ]
  }")"
OTEL_SOURCE_EVENT_ID="$(printf '%s' "${OTEL_RESPONSE}" | json_field sourceEventId)"
echo "  accepted ${OTEL_SOURCE_EVENT_ID}"

echo "Waiting for writer to append connector events..."
wait_for_appended_event "sagemaker" "${PROXY_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "sagemaker" "${PROXY_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "sagemaker" "${PROXY_SOURCE_EVENT_ID}" "unverified"
fi
wait_for_appended_event "openlineage" "${PROXY_OL_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "openlineage" "${PROXY_OL_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "openlineage" "${PROXY_OL_SOURCE_EVENT_ID}" "unverified"
fi
wait_for_appended_event "azureml" "${PROXY_AZ_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "azureml" "${PROXY_AZ_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "azureml" "${PROXY_AZ_SOURCE_EVENT_ID}" "unverified"
fi
wait_for_appended_event "cloudevents" "${PROXY_CE_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "cloudevents" "${PROXY_CE_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "cloudevents" "${PROXY_CE_SOURCE_EVENT_ID}" "unverified"
fi
wait_for_appended_event "databricks" "${PROXY_DBX_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "databricks" "${PROXY_DBX_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "databricks" "${PROXY_DBX_SOURCE_EVENT_ID}" "unverified"
fi
wait_for_appended_event "opentelemetry" "${PROXY_OTEL_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "opentelemetry" "${PROXY_OTEL_SOURCE_EVENT_ID}" "shared_secret"
else
  wait_for_event_verification "opentelemetry" "${PROXY_OTEL_SOURCE_EVENT_ID}" "unverified"
fi
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
wait_for_appended_event "azureml" "${AZ_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "azureml" "${AZ_SOURCE_EVENT_ID}" "shared_secret"
fi
wait_for_appended_event "cloudevents" "${CE_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "cloudevents" "${CE_SOURCE_EVENT_ID}" "shared_secret"
fi
wait_for_appended_event "databricks" "${DBX_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "databricks" "${DBX_SOURCE_EVENT_ID}" "shared_secret"
fi
wait_for_appended_event "openlineage" "${OL_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "openlineage" "${OL_SOURCE_EVENT_ID}" "shared_secret"
fi
wait_for_appended_event "opentelemetry" "${OTEL_SOURCE_EVENT_ID}"
if [[ -n "${INGEST_KEY}" ]]; then
  wait_for_event_verification "opentelemetry" "${OTEL_SOURCE_EVENT_ID}" "shared_secret"
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
assert_provenance "${AZ_MODEL_ID}" 1
assert_provenance "${CE_MODEL_ID}" 1
assert_provenance "${DBX_MODEL_ID}" 1
assert_provenance "${OL_MODEL_ID}" 1
assert_provenance "${OTEL_MODEL_ID}" 1

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
echo "Azure ML model: ${AZ_MODEL_ID}"
echo "CloudEvents model: ${CE_MODEL_ID}"
echo "Databricks model: ${DBX_MODEL_ID}"
echo "OpenLineage model: ${OL_MODEL_ID}"
echo "OpenTelemetry model: ${OTEL_MODEL_ID}"
echo "Events: ${FRONTEND_BASE}/events"
echo "Connectors: ${FRONTEND_BASE}/connectors"
