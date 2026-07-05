"""Unit tests for the MLflow watcher core (no mlflow install required: everything
is injected). Run with:
    PYTHONPATH=integrations/mlflow python3 -m unittest discover -s integrations/mlflow/tests
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from watch_mlflow import find_new_versions, is_duplicate_rejection, run_once  # noqa: E402


def fake_run(run_id: str) -> NS:
    return NS(
        info=NS(
            run_id=run_id,
            artifact_uri=f"s3://bucket/{run_id}",
            experiment_id="0",
            status="FINISHED",
            start_time=1,
            end_time=2,
            run_name=f"run-{run_id}",
        ),
        data=NS(params={"n_neighbors": "3"}, metrics={"accuracy": "0.97"}, tags={}),
    )


def version(name: str, number: int, created: int, run_id: str) -> NS:
    return NS(name=name, version=str(number), creation_timestamp=created, run_id=run_id, current_stage="None")


class FakeClient:
    def __init__(self, versions):
        self.versions = versions

    def search_model_versions(self, _filter):
        return list(self.versions)

    def get_run(self, run_id):
        return fake_run(run_id)

    def download_artifacts(self, *args):
        raise RuntimeError("no artifacts in unit tests")  # forces metadata-fallback hash


class RecordingSubmit:
    def __init__(self, responses):
        self.responses = list(responses)
        self.payloads = []

    def __call__(self, payload):
        self.payloads.append(payload)
        return self.responses.pop(0) if self.responses else (201, "{}")


class FindNewVersionsTest(unittest.TestCase):
    def test_filters_by_watermark_and_sorts_oldest_first(self):
        client = FakeClient([
            version("m", 3, 300, "r3"),
            version("m", 1, 100, "r1"),
            version("m", 2, 200, "r2"),
        ])
        fresh = find_new_versions(client, 100)
        self.assertEqual([v.version for v in fresh], ["2", "3"])


class RunOnceTest(unittest.TestCase):
    def test_registers_new_versions_and_advances_watermark(self):
        client = FakeClient([version("demo", 1, 100, "r1"), version("demo", 2, 200, "r2")])
        submit = RecordingSubmit([(201, "{}"), (201, "{}")])

        state = run_once(client, {}, submit, log=lambda *a, **k: None)

        self.assertEqual(state["lastCreationTimestamp"], 200)
        self.assertEqual(len(submit.payloads), 2)
        first = submit.payloads[0]
        self.assertEqual(first["modelId"], "demo")
        self.assertEqual(first["version"], "1")
        self.assertEqual(len(first["mlflow"]["modelHash"]), 64)
        self.assertEqual(first["metrics"]["accuracy"], 0.97)
        self.assertEqual(first["metadata"]["mlflowRegisteredModelName"], "demo")

    def test_duplicate_rejection_is_idempotent_success(self):
        client = FakeClient([version("demo", 1, 100, "r1")])
        submit = RecordingSubmit([(400, 'Model with modelName ... already exists.')])

        state = run_once(client, {}, submit, log=lambda *a, **k: None)

        self.assertEqual(state["lastCreationTimestamp"], 100, "duplicate must advance the watermark")

    def test_hard_failure_stops_batch_without_skipping(self):
        client = FakeClient([version("demo", 1, 100, "r1"), version("demo", 2, 200, "r2")])
        submit = RecordingSubmit([(500, "boom")])

        state = run_once(client, {}, submit, log=lambda *a, **k: None)

        self.assertNotIn("lastCreationTimestamp", state, "failed version must be retried next cycle")
        self.assertEqual(len(submit.payloads), 1, "batch must stop at the failure, preserving order")

    def test_second_cycle_resumes_after_watermark(self):
        client = FakeClient([version("demo", 1, 100, "r1"), version("demo", 2, 200, "r2")])
        submit = RecordingSubmit([(201, "{}"), (201, "{}")])
        state = run_once(client, {}, submit, log=lambda *a, **k: None)

        again = RecordingSubmit([])
        state = run_once(client, state, again, log=lambda *a, **k: None)
        self.assertEqual(len(again.payloads), 0, "no re-submission once the watermark passed them")


class DuplicateDetectionTest(unittest.TestCase):
    def test_only_400_with_marker_counts(self):
        self.assertTrue(is_duplicate_rejection(400, "version '1' already exists."))
        self.assertFalse(is_duplicate_rejection(400, "validation failed"))
        self.assertFalse(is_duplicate_rejection(500, "already exists"))


if __name__ == "__main__":
    unittest.main()
