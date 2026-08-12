"""DS-LAKE-006-T05: `artifact_service.features` — the GOLD write.

Reuses `RecordingStore`/`frame` from `test_artifact_service.py` rather than
re-deriving an in-memory store fake — same reasoning that file itself states:
a guarantee that skips when MinIO is down proves nothing, so storage is
faked, not skipped.
"""

from __future__ import annotations

import pytest

from intergrations.object_store import ObjectStoreError
from schemas.preprocess import FeatureConfigRequest, FeaturesRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, frame


def test_features_writes_the_target_and_leaves_the_source_alone() -> None:
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=1)
            ],
        ),
    )

    assert result["object_key"] == "ds-1/artifacts/gold-id/data.parquet"
    assert "duration_ms" in result
    assert store.objects["ds-1/artifacts/silver-id/data.parquet"].equals(frame())
    assert store.writes == ["ds-1/artifacts/gold-id/data.parquet"]


def test_features_sets_parent_key_to_the_silver_source() -> None:
    """The manifest-level lineage pointer (object-store side, distinct from
    Postgres's DatasetArtifact.parentArtifactId FK, which NestJS sets when
    it persists the row this response feeds)."""
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
        ),
    )
    manifest = store.documents["ds-1/artifacts/gold-id/manifest.json"]
    assert manifest["parent_key"] == "ds-1/artifacts/silver-id/data.parquet"


def test_features_writes_feature_spec_sidecar_and_returns_its_key() -> None:
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=1)
            ],
            selected_columns=None,
            scalers={"TI-101": "minmax"},
        ),
    )

    assert result["feature_spec_key"] == "ds-1/artifacts/gold-id/feature_spec.json"
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    assert spec["features"][0]["name"] == "TI-101__lag1"
    assert spec["scaling"] == [{"tag": "TI-101", "method": "minmax"}]
    assert isinstance(spec["featureHash"], str)
    # column_stats is a cleaning-op concern only — features() has nothing to
    # compute drift/coverage against, so it must stay unset.
    assert result["column_stats_key"] is None


def test_features_rejects_a_target_equal_to_its_source() -> None:
    with pytest.raises(ValueError, match="must differ"):
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/silver-id/data.parquet",
            features=[],
        )


def test_features_refuses_to_write_over_a_committed_artifact() -> None:
    store = RecordingStore(
        {"ds-1/artifacts/silver-id/data.parquet": frame(), "ds-1/artifacts/gold-id/data.parquet": frame()}
    )
    with pytest.raises(ObjectStoreError, match="immutable"):
        artifact_service.features(
            store,
            FeaturesRequest(
                source_key="ds-1/artifacts/silver-id/data.parquet",
                target_key="ds-1/artifacts/gold-id/data.parquet",
                features=[],
            ),
        )


def test_features_formula_kind_raises_not_implemented() -> None:
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    with pytest.raises(NotImplementedError, match="formula"):
        artifact_service.features(
            store,
            FeaturesRequest(
                source_key="ds-1/artifacts/silver-id/data.parquet",
                target_key="ds-1/artifacts/gold-id/data.parquet",
                features=[
                    FeatureConfigRequest(
                        id="f1", kind="formula", expr="c0 + 1", vars={"c0": "TI-101"}
                    )
                ],
            ),
        )
    # A rejected write must not have written the target — same "no partial
    # commit" discipline the cleaning path already holds.
    assert store.writes == []


def test_features_applies_select_columns_before_returning() -> None:
    """selectColumns actually narrows the written frame's columns, proving
    the endpoint's fixed order (features -> select -> scale) runs select at
    all, not just accepts the field and ignores it."""
    from intergrations.object_store import tag_columns

    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            selected_columns=["TI-101"],
        ),
    )
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    assert tag_columns(written) == ["TI-101"]
