#!/usr/bin/env python3
"""Continuously mirror new MLflow model versions into Ernest.

This is the production-shaped MLflow integration: OSS MLflow has no native
webhooks, so a poller watches the model registry and registers every new model
version in Ernest as tamper-evident provenance. Idempotency comes from Ernest
itself — a duplicate (modelId, version) registration is rejected with 400 before
touching the hashchain — so the watcher is crash-safe: on restart it may re-submit
recent versions and they bounce off harmlessly.

Configuration (environment):
  MLFLOW_TRACKING_URI        MLflow tracking server (required)
  ERNEST_API_BASE            Ernest API base, e.g. http://backend:3001/api
  ERNEST_API_KEY             read-write key or token (required when gated)
  ERNEST_ORG_ID              optional organization scope
  WATCHER_POLL_SECONDS       poll interval (default 30)
  WATCHER_STATE_FILE         watermark path (default /state/mlflow-watcher.json)
  WATCHER_BACKFILL           all | none — on first run, register every existing
                             version (all, default) or only versions created from
                             now on (none)
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from register_mlflow_run import load_mlflow, payload_from_run, submit_to_ernest


def load_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    tmp.replace(path)


def find_new_versions(client, last_creation_ts: int) -> list:
    """Model versions strictly newer than the watermark, oldest first, so the
    watermark can advance monotonically as each one lands."""
    versions = client.search_model_versions("")
    fresh = [v for v in versions if int(getattr(v, "creation_timestamp", 0) or 0) > last_creation_ts]
    return sorted(fresh, key=lambda v: (int(v.creation_timestamp), v.name, int(v.version)))


def is_duplicate_rejection(status: int, body: str) -> bool:
    return status == 400 and "already exists" in body


def process_version(client, model_version, submit, log=print) -> bool:
    """Registers one model version in Ernest. Returns True when the version is
    durably recorded (created now, or already there from a previous run)."""
    run = client.get_run(model_version.run_id)
    payload = payload_from_run(
        client,
        run,
        model_version=model_version,
        org_id=os.getenv("ERNEST_ORG_ID"),
    )
    status, body = submit(payload)
    if status < 300:
        log(f"registered {payload['modelId']} v{payload['version']} in Ernest")
        return True
    if is_duplicate_rejection(status, body):
        log(f"{payload['modelId']} v{payload['version']} already registered (idempotent)")
        return True
    log(f"Ernest rejected {payload['modelId']} v{payload['version']}: {status} {body[:300]}", file=sys.stderr)
    return False


def run_once(client, state: dict, submit, log=print) -> dict:
    """One poll cycle. Advances the watermark only through versions that were
    durably recorded; a hard failure stops the batch so the next cycle retries
    from the same point instead of skipping evidence."""
    watermark = int(state.get("lastCreationTimestamp", 0))
    for model_version in find_new_versions(client, watermark):
        if not process_version(client, model_version, submit, log):
            break
        watermark = int(model_version.creation_timestamp)
        state["lastCreationTimestamp"] = watermark
    return state


def main() -> int:
    tracking_uri = os.getenv("MLFLOW_TRACKING_URI")
    if not tracking_uri:
        print("MLFLOW_TRACKING_URI is required", file=sys.stderr)
        return 2

    api_base = os.getenv("ERNEST_API_BASE", "http://localhost:3001/api")
    api_key = os.getenv("ERNEST_API_KEY")
    org_id = os.getenv("ERNEST_ORG_ID")
    poll_seconds = int(os.getenv("WATCHER_POLL_SECONDS", "30"))
    state_path = Path(os.getenv("WATCHER_STATE_FILE", "/state/mlflow-watcher.json"))

    mlflow, MlflowClient = load_mlflow()
    mlflow.set_tracking_uri(tracking_uri)
    client = MlflowClient()

    state = load_state(state_path)
    if "lastCreationTimestamp" not in state and os.getenv("WATCHER_BACKFILL", "all") == "none":
        state["lastCreationTimestamp"] = int(time.time() * 1000)

    def submit(payload):
        return submit_to_ernest(api_base, payload, api_key, org_id)

    print(f"mlflow-watcher: polling {tracking_uri} every {poll_seconds}s → {api_base}")
    while True:
        try:
            state = run_once(client, state, submit)
            save_state(state_path, state)
        except KeyboardInterrupt:
            return 0
        except Exception as exc:  # network blips must not kill the watcher
            print(f"poll cycle failed (will retry): {exc}", file=sys.stderr)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
