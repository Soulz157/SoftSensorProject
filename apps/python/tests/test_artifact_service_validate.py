"""DS-LAKE-007-T02: `artifact_service.validate`."""

from __future__ import annotations

from schemas.preprocess import ValidateRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, frame


def test_validate_writes_the_report_sidecar_and_returns_its_key() -> None:
    store = RecordingStore({"ds-1/artifacts/gold-1/data.parquet": frame()})
    result = artifact_service.validate(
        store,
        ValidateRequest(source_key="ds-1/artifacts/gold-1/data.parquet"),
    )

    key = "ds-1/artifacts/gold-1/validation_report.json"
    assert result["validation_report_key"] == key
    assert store.documents[key]["status"] in ("PASS", "FAIL")
    # Read-only against the DATA object — no data write, only the sidecar.
    assert store.writes == []


def test_validate_reads_and_passes_through_the_feature_spec_when_given() -> None:
    store = RecordingStore({"ds-1/artifacts/gold-1/data.parquet": frame()})
    spec_key = "ds-1/artifacts/gold-1/feature_spec.json"
    store.documents[spec_key] = {"features": [{"name": "TI-101"}]}

    result = artifact_service.validate(
        store,
        ValidateRequest(
            source_key="ds-1/artifacts/gold-1/data.parquet",
            feature_spec_key=spec_key,
        ),
    )

    names = {c["name"] for c in result["checks"]}
    consistency = next(c for c in result["checks"] if c["name"] == "feature_consistency")
    assert "feature_consistency" in names
    assert not consistency["skipped"]  # a real spec was supplied, not None


def test_validate_skips_feature_consistency_without_a_spec_key() -> None:
    store = RecordingStore({"ds-1/artifacts/silver-1/data.parquet": frame()})
    result = artifact_service.validate(
        store,
        ValidateRequest(source_key="ds-1/artifacts/silver-1/data.parquet"),
    )
    consistency = next(c for c in result["checks"] if c["name"] == "feature_consistency")
    assert consistency["skipped"]


def test_validate_applies_a_custom_threshold_when_given() -> None:
    store = RecordingStore({"ds-1/artifacts/gold-1/data.parquet": frame()})
    # frame() (test_artifact_service's fixture) has one Bad cell out of 6 —
    # ~16.7% missing. Default threshold (20%) passes it; a tight override
    # must fail it, proving the override actually reaches validation_service
    # rather than being silently ignored.
    result = artifact_service.validate(
        store,
        ValidateRequest(
            source_key="ds-1/artifacts/gold-1/data.parquet",
            max_missing_pct=5.0,
        ),
    )
    missing = next(c for c in result["checks"] if c["name"] == "missing_values")
    assert not missing["passed"]
    assert missing["threshold"] == 5.0
