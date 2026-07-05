#!/usr/bin/env python3
"""Register an MLflow run or model version in Ernest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.error
import urllib.request


COMMON_ARTIFACT_PATHS = ("model", "iris_model", "sklearn-model")


def load_mlflow():
    try:
        import mlflow  # type: ignore
        from mlflow.tracking import MlflowClient  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "MLflow is required for this integration. Install it with: pip install mlflow"
        ) from exc
    return mlflow, MlflowClient


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_path(path: Path) -> str:
    if path.is_file():
        return sha256_file(path)

    digest = hashlib.sha256()
    files = sorted(p for p in path.rglob("*") if p.is_file())
    for file_path in files:
        rel = file_path.relative_to(path).as_posix().encode("utf-8")
        digest.update(rel)
        digest.update(b"\0")
        with file_path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def stable_json_hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def short_hex(value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
    return digest[:12]


def resolve_latest_model_version(client, registered_model_name: str):
    try:
        versions = client.get_latest_versions(registered_model_name)
    except Exception:
        versions = client.search_model_versions(f"name = '{registered_model_name}'")

    if not versions:
        raise SystemExit(f"No MLflow model versions found for {registered_model_name!r}")

    def version_number(item):
        try:
            return int(item.version)
        except (TypeError, ValueError):
            return 0

    return sorted(versions, key=version_number)[-1]


def download_artifact_hash(client, run_id: str, artifact_path: str | None) -> tuple[str, str]:
    paths = [artifact_path] if artifact_path else list(COMMON_ARTIFACT_PATHS)
    errors: list[str] = []

    with tempfile.TemporaryDirectory(prefix="ernest-mlflow-") as tmpdir:
        for candidate in paths:
            if not candidate:
                continue
            try:
                downloaded = Path(client.download_artifacts(run_id, candidate, tmpdir))
                return sha256_path(downloaded), candidate
            except Exception as exc:
                errors.append(f"{candidate}: {exc}")

    raise RuntimeError("; ".join(errors) if errors else "No artifact path provided")


def payload_from_run(
    client,
    run,
    *,
    model_version=None,
    model_id=None,
    model_name=None,
    version=None,
    git_commit=None,
    artifact_path=None,
    org_id=None,
) -> dict:
    """Core mapping from an MLflow run (plus optional registry version) to an Ernest
    registration payload. Shared by the one-shot CLI below and the continuous
    watcher (watch_mlflow.py) so both submit byte-identical evidence."""
    run_id = run.info.run_id
    params = dict(run.data.params)
    metrics = {key: float(value) for key, value in run.data.metrics.items()}
    tags = dict(run.data.tags)

    artifact_hash_source = artifact_path or "auto"
    try:
        model_hash, artifact_hash_source = download_artifact_hash(client, run_id, artifact_path)
    except Exception:
        model_hash = stable_json_hash(
            {
                "run_id": run_id,
                "artifact_uri": run.info.artifact_uri,
                "params": params,
                "metrics": metrics,
                "tags": tags,
            }
        )
        artifact_hash_source = "run-metadata-fallback"

    git_commit = (
        git_commit
        or tags.get("mlflow.source.git.commit")
        or tags.get("git.commit")
        or os.getenv("GIT_COMMIT")
        or short_hex(run_id)
    )

    run_name = getattr(run.info, "run_name", None) or tags.get("mlflow.runName")
    registered_name = model_version.name if model_version else None
    model_id = model_id or registered_name or run_name or run_id
    model_name = model_name or registered_name or run_name or model_id
    version = version or (str(model_version.version) if model_version else "mlflow-run")

    metadata = {
        "source": "integrations/mlflow",
        "mlflowRunId": run_id,
        "mlflowExperimentId": run.info.experiment_id,
        "mlflowArtifactUri": run.info.artifact_uri,
        "artifactHashSource": artifact_hash_source,
        "mlflowStatus": run.info.status,
        "mlflowStartTime": run.info.start_time,
        "mlflowEndTime": run.info.end_time,
        "mlflowTags": tags,
    }
    if model_version:
        metadata.update(
            {
                "mlflowRegisteredModelName": model_version.name,
                "mlflowModelVersion": model_version.version,
                "mlflowModelCurrentStage": getattr(model_version, "current_stage", None),
            }
        )

    return {
        "modelId": model_id,
        "modelName": model_name,
        "version": version,
        "modelPath": run.info.artifact_uri,
        "mlflow": {
            "modelHash": model_hash,
            "gitCommit": git_commit,
        },
        "params": params,
        "metrics": metrics,
        "metadata": metadata,
        **({"organizationId": org_id} if org_id else {}),
    }


def build_payload(args) -> dict:
    mlflow, MlflowClient = load_mlflow()
    if args.tracking_uri:
        mlflow.set_tracking_uri(args.tracking_uri)

    client = MlflowClient()

    model_version = None
    run_id = args.run_id
    if not run_id:
        if not args.registered_model_name:
            raise SystemExit("Provide either --run-id or --registered-model-name")
        model_version = resolve_latest_model_version(client, args.registered_model_name)
        run_id = model_version.run_id

    run = client.get_run(run_id)
    return payload_from_run(
        client,
        run,
        model_version=model_version,
        model_id=args.model_id or args.registered_model_name,
        model_name=args.model_name or args.registered_model_name,
        version=args.version,
        git_commit=args.git_commit,
        artifact_path=args.artifact_path,
        org_id=args.org_id,
    )


def submit_to_ernest(api_base: str, payload: dict, api_key: str | None, org_id: str | None) -> tuple[int, str]:
    """POST a registration payload. Returns (status_code, body) without raising on
    HTTP errors, so callers can treat duplicate registrations as idempotent."""
    url = api_base.rstrip("/") + "/models"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            **({"X-Ernest-Api-Key": api_key} if api_key else {}),
            **({"X-Ernest-Org-Id": org_id} if org_id else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def post_to_ernest(api_base: str, payload: dict, api_key: str | None, org_id: str | None) -> dict:
    status, body = submit_to_ernest(api_base, payload, api_key, org_id)
    if status >= 400:
        raise SystemExit(f"Ernest API returned {status}: {body}")
    return json.loads(body)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracking-uri", default=os.getenv("MLFLOW_TRACKING_URI"))
    parser.add_argument("--run-id")
    parser.add_argument("--registered-model-name")
    parser.add_argument("--artifact-path")
    parser.add_argument("--model-id")
    parser.add_argument("--model-name")
    parser.add_argument("--version")
    parser.add_argument("--git-commit")
    parser.add_argument("--org-id", default=os.getenv("ERNEST_ORG_ID"))
    parser.add_argument("--ernest-api-base", default=os.getenv("ERNEST_API_BASE", "http://localhost:3001/api"))
    parser.add_argument("--ernest-api-key", default=os.getenv("ERNEST_API_KEY"))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    payload = build_payload(args)

    if args.dry_run:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0

    result = post_to_ernest(args.ernest_api_base, payload, args.ernest_api_key, args.org_id)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
