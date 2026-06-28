#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.mlflow.yml)

compose() {
  if [[ -f .env ]]; then
    docker compose "${COMPOSE_FILES[@]}" --env-file .env "$@"
  else
    docker compose "${COMPOSE_FILES[@]}" "$@"
  fi
}

RUN_ID="$(date +%Y%m%d%H%M%S)"
export IRIS_MODEL_ID="${IRIS_MODEL_ID:-iris-classifier-${RUN_ID}}"
export IRIS_MODEL_NAME="${IRIS_MODEL_NAME:-Iris KNN classifier}"
export IRIS_MODEL_VERSION="${IRIS_MODEL_VERSION:-${RUN_ID}}"
export IRIS_REGISTERED_MODEL_NAME="${IRIS_REGISTERED_MODEL_NAME:-ernest-iris-demo}"

compose up -d --build mongodb backend frontend mlflow
compose run --rm mlflow-demo

cat <<MSG

MLflow to Ernest demo complete.

Model ID: ${IRIS_MODEL_ID}
Dashboard: http://localhost:3000
Audit Readiness: http://localhost:3000/auditor
MLflow UI: http://localhost:8111
Backend provenance: http://localhost:3001/api/provenances/${IRIS_MODEL_ID}
MSG
