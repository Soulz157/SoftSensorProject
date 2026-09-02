"""MODEL-FLOW-016-T08/T07: `artifact_service.presign_run_object`.

Fixes a live defect, not a latent one: `claim()` used to read a run's own
`validate_ready.parquet` via `/artifacts/presign`, whose guard
(`is_committed_artifact_key`) requires `"/artifacts/" in key` — always false
for a run-scoped `drafts/{draftId}/runs/{runId}/...` or
`models/{modelId}/runs/{runId}/...` key. Confirmed live (2026-09-01) against
the real database and object store: this refusal fired on every run whose
dataset actually had a holdout, so `holdoutMetrics` was null on 100% of runs
for a reason unrelated to whether a holdout existed at all.

Only the GUARD (filename + key-shape) is exercised here with a fake store,
the same boundary `test_artifact_service.py`'s own `get_run_manifest` guard
tests draw — both raise `ValueError` before the store's presign primitives
(`presigned_get`/`checksum_of`/`get_frame_metadata`) are ever called, so a
`RecordingStore` with none of those implemented is enough to prove the
refusal paths. Those primitives themselves are shared, unmodified code
`presign_artifact` already exercises live (this codebase has no unit test
for that function either, for the same reason — a presigned URL against a
real bucket is verified live, not stubbed) and are proven end-to-end in this
feature's own V05 once the trainer image is rebuilt.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from schemas.preprocess import RunObjectPresignRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore


class _PresignStub:
    """Minimal stub for the T07 model.joblib acceptance path — just enough
    to prove the ALLOWLIST accepts the filename and skips the row_count
    computation (get_frame_metadata is never called, deliberately not
    implemented here so a regression calling it would raise loudly)."""

    PRESIGN_READ_TTL = timedelta(minutes=15)

    def presigned_get(self, key: str) -> str:
        return f"https://minio.example/{key}"

    def checksum_of(self, key: str) -> str:
        return "stub-checksum"


def test_refuses_a_key_not_named_validate_ready_parquet() -> None:
    with pytest.raises(ValueError, match="validate_ready.parquet"):
        artifact_service.presign_run_object(
            RecordingStore(),
            RunObjectPresignRequest(
                source_key="drafts/d1/runs/r1/predictions.parquet"
            ),
        )


def test_accepts_model_joblib_with_no_row_count() -> None:
    result = artifact_service.presign_run_object(
        _PresignStub(),
        RunObjectPresignRequest(source_key="drafts/d1/runs/r1/model.joblib"),
    )
    assert result["data_url"] == "https://minio.example/drafts/d1/runs/r1/model.joblib"
    assert result["checksum"] == "stub-checksum"
    assert result["row_count"] is None


def test_refuses_a_malformed_run_key() -> None:
    with pytest.raises(ValueError, match="well-formed training-run"):
        artifact_service.presign_run_object(
            RecordingStore(),
            RunObjectPresignRequest(source_key="ds-1/validate_ready.parquet"),
        )


def test_refuses_a_committed_dataset_artifact_key() -> None:
    """The exact key shape the pre-fix code was refusing to read: a
    validate_ready.parquet written under a run prefix is NOT an
    `/artifacts/...` committed dataset artifact, and must not be mistaken
    for one just because it shares the same base filename convention."""
    with pytest.raises(ValueError, match="well-formed training-run"):
        artifact_service.presign_run_object(
            RecordingStore(),
            RunObjectPresignRequest(
                source_key="ds-1/artifacts/a1/validate_ready.parquet"
            ),
        )
