"""DS-LAKE-006-T05: `artifact_service.features` — the GOLD write.

Reuses `RecordingStore`/`frame` from `test_artifact_service.py` rather than
re-deriving an in-memory store fake — same reasoning that file itself states:
a guarantee that skips when MinIO is down proves nothing, so storage is
faked, not skipped.
"""

from __future__ import annotations

import pytest

from intergrations.object_store import ObjectStoreError, tag_columns
from schemas.preprocess import FeatureConfigRequest, FeaturesRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, frame, wide_frame


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


def test_features_formula_kind_is_computed() -> None:
    """The port closing this: `formula` used to raise `NotImplementedError`
    unconditionally (see git history) — it is now a real dispatch through
    `formula_service.py` for the arithmetic subset that actually reaches this
    module. Requests `scaler: 'none'` on the derived column so the raw
    computed values survive to this assertion — `to_model_ready` (the last
    pipeline stage) scales every FINITE value AND force-sets its status to
    Good regardless of origin (see `feature_service.py`'s own docstring on
    that), so it launders exactly the Bad-row status this test would
    otherwise want to check; that check lives instead at the `apply_features`
    level, before scaling, in `test_feature_quirks.py`.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(
                    id="f1",
                    kind="formula",
                    name="c0_plus_1",
                    expr="c0 + 1",
                    vars={"c0": "TI-101"},
                )
            ],
            scalers={"c0_plus_1": "none"},
        ),
    )

    assert result["object_key"] == "ds-1/artifacts/gold-id/data.parquet"
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    # frame()'s TI-101 is [70, 71, 0(Bad), 73, 74, 75] + 1 each; the Bad row's
    # "+1" is never computed — formula emits its own 0.0 hole, same as every
    # other feature kind on a Bad source cell.
    assert list(written["c0_plus_1"]) == [71.0, 72.0, 0.0, 74.0, 75.0, 76.0]


def test_features_formula_kind_rejects_pow_and_writes_nothing() -> None:
    """`^` is excluded deliberately (JS/Python numeric divergence on
    non-integer exponents — see `formula_service.py`'s module docstring),
    not merely unimplemented. Preserves the "no partial commit" discipline
    the old raises-test checked: a rejected write must not touch the target,
    same guarantee the cleaning path already holds.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    with pytest.raises(ValueError, match="\\^"):
        artifact_service.features(
            store,
            FeaturesRequest(
                source_key="ds-1/artifacts/silver-id/data.parquet",
                target_key="ds-1/artifacts/gold-id/data.parquet",
                features=[
                    FeatureConfigRequest(
                        id="f1", kind="formula", expr="c0 ^ 2", vars={"c0": "TI-101"}
                    )
                ],
            ),
        )
    assert store.writes == []


def test_features_surfaces_a_collision_skip_and_excludes_it_from_the_spec() -> None:
    """A feature named `TI-101` collides with the real tag already in the
    frame — `apply_features` keeps its idempotent skip (unchanged semantics,
    a deliberate decision, not a default), but the response must name the
    skip and `feature_spec.json` must not list a feature that never
    computed, or the spec would claim something false about the artifact.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(
                    id="f1", kind="lag", tag="TI-101", k=1
                ),
                # feature_column_name({"kind": "formula", "name": "TI-101"})
                # returns "TI-101" verbatim (the `name` branch strips to the
                # raw name, no suffix) — colliding with the real tag column
                # already on the frame.
                FeatureConfigRequest(
                    id="f2",
                    kind="formula",
                    name="TI-101",
                    expr="c0 + 1",
                    vars={"c0": "TI-101"},
                ),
            ],
        ),
    )

    assert result["skipped_features"] == ["TI-101"]
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    spec_names = [f["name"] for f in spec["features"]]
    assert "TI-101" not in spec_names
    assert spec_names == ["TI-101__lag1"]


def test_features_force_keeps_target_through_select_columns() -> None:
    """MODEL-FLOW-000-T02: force_keep_target must feed the ACTUAL column
    drop, not just the spec. A caller can omit the target from
    selected_columns (Step 4's UI has no reason to know it must include it)
    — the target must survive anyway, or the GOLD artifact looks fine and
    is not: it fails only much later, at model-fit time, in a different
    service (force_keep_target's own docstring).

    wide_frame() carries TI-101 and FI-404; selected_columns names TI-101
    only, target_y is FI-404 — omitted from the explicit list on purpose.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": wide_frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            selected_columns=["TI-101"],
            target_y="FI-404",
        ),
    )

    # The bytes actually written carry the target — not just the spec.
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    assert "FI-404" in tag_columns(written)
    assert "TI-101" in tag_columns(written)

    # The spec's selectedColumns must agree with what was actually written
    # — a spec claiming a narrower set than the bytes contain would make
    # the featureHash describe an artifact that doesn't exist.
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    assert spec["selectedColumns"] == ["TI-101", "FI-404"]
    assert result["feature_spec_key"] == "ds-1/artifacts/gold-id/feature_spec.json"


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
