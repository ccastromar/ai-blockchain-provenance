#!/usr/bin/env bash
set -euo pipefail

# E2E for the continuous MLflow → Ernest watcher: train and register a model version
# ONLY in MLflow (--step train), then assert the watcher mirrors it into Ernest as
# provenance without anyone calling the Ernest API for it.

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.mlflow.yml)

compose() {
  if [[ -f .env ]]; then
    docker compose "${COMPOSE_FILES[@]}" --env-file .env "$@"
  else
    docker compose "${COMPOSE_FILES[@]}" "$@"
  fi
}

RUN_ID="$(date +%Y%m%d%H%M%S)"
export IRIS_MODEL_ID="watcher-e2e-${RUN_ID}"
export IRIS_REGISTERED_MODEL_NAME="watcher-e2e-${RUN_ID}"
export WATCHER_POLL_SECONDS=5

ERNEST_API_KEY="${ERNEST_API_KEY:-}"
AUTH_HEADERS=()
if [[ -n "${ERNEST_API_KEY}" ]]; then
  AUTH_HEADERS=(-H "X-Ernest-Api-Key: ${ERNEST_API_KEY}")
fi

echo "Starting stack (mongodb, backend, mlflow, mlflow-watcher)..."
compose up -d --build mongodb backend mlflow mlflow-watcher

echo "Training + registering model version ONLY in MLflow (${IRIS_REGISTERED_MODEL_NAME})..."
compose run --rm --no-deps \
  -e IRIS_MODEL_ID="${IRIS_MODEL_ID}" \
  -e IRIS_REGISTERED_MODEL_NAME="${IRIS_REGISTERED_MODEL_NAME}" \
  mlflow-demo python train_and_register.py --step train

echo "Waiting for the watcher to mirror it into Ernest..."
for _ in $(seq 1 24); do
  if curl --fail --silent "${AUTH_HEADERS[@]+"${AUTH_HEADERS[@]}"}" \
      "http://localhost:3001/api/models/${IRIS_REGISTERED_MODEL_NAME}" >/dev/null 2>&1; then
    echo "Watcher registered ${IRIS_REGISTERED_MODEL_NAME} in Ernest."
    PROV="$(curl --fail --silent "${AUTH_HEADERS[@]+"${AUTH_HEADERS[@]}"}" \
      "http://localhost:3001/api/provenances/${IRIS_REGISTERED_MODEL_NAME}")"
    printf '%s' "${PROV}" | python3 -c 'import json,sys
data = json.load(sys.stdin)
assert data["totalBlocks"] >= 1, data
assert data["chainValid"] is True, data
meta = data["history"][0].get("metadata") or {}
assert meta.get("mlflowRegisteredModelName"), "block must carry MLflow registry metadata"
print(f"Provenance block present (chain valid, {data[\"totalBlocks\"]} block/s, MLflow run {meta.get(\"mlflowRunId\")})")'
    echo
    echo "MLflow watcher E2E complete."
    exit 0
  fi
  sleep 5
done

echo "Watcher did not register ${IRIS_REGISTERED_MODEL_NAME} within the timeout" >&2
compose logs --tail 30 mlflow-watcher >&2
exit 1
