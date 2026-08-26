"""DS-LAKE-006-T05: `artifact_service.features` — the GOLD write.

Reuses `RecordingStore`/`frame` from `test_artifact_service.py` rather than
re-deriving an in-memory store fake — same reasoning that file itself states:
a guarantee that skips when MinIO is down proves nothing, so storage is
faked, not skipped.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD, ObjectStoreError, tag_columns
from schemas.preprocess import (
    CleanRequest,
    CleaningOperation,
    FeatureConfigRequest,
    FeaturesRequest,
    HoldoutSplitRequest,
    ScaleRequest,
)
from services import artifact_service
from tests.test_artifact_service import RecordingStore, _daily_frame, frame, wide_frame


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
    # CORRECTED (DS-LAKE-022-T03): this asserted `column_stats_key is None` on
    # the reading that "column_stats is a cleaning-op concern only". That
    # stopped being true at DS-LAKE-006-T05, which made features() call
    # build_column_stats unconditionally and documented why: coverage/min/max/
    # mean/median/std describe the COLUMN, and this is the one stage that
    # MINTS columns, so a derived feature has no stats computed anywhere
    # upstream. The assertion had been failing ever since; it was the stale
    # half, not the code.
    assert result["column_stats_key"] == "ds-1/artifacts/gold-id/column_stats.json"


def test_features_writes_the_real_fitted_scaling_params() -> None:
    """DS-LAKE-018-T02 end to end: `features()` -> `to_model_ready` ->
    `build_feature_spec` must land the ACTUAL fitted min/max in the written
    sidecar, not a placeholder. `frame()`'s TI-101 is [70, 71, 0, 73, 74,
    75]. CORRECTED (DS-LAKE-023-T05): this used to assert min=0.0, since the
    0.0 at the Bad-status row was still FINITE and `to_model_ready` fits
    every finite value regardless of status. `drop_bad_feature_rows` now
    excludes that row BEFORE `to_model_ready` ever sees it, so the fitted
    min is the real 70.0."""
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            selected_columns=None,
            scalers={"TI-101": "minmax"},
        ),
    )
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    assert spec["scalingParams"] == {"TI-101": {"min": 70.0, "max": 75.0}}


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
    computed values survive to this assertion.

    CORRECTED (DS-LAKE-023-T05): this used to assert the Bad row's "+1"
    survived as a laundered 0.0 (`to_model_ready` scales every FINITE value
    AND force-sets its status to Good regardless of origin). Now
    `drop_bad_feature_rows` excludes that row entirely BEFORE `to_model_ready`
    runs, so it is simply absent from the written frame — 5 rows, not 6. The
    ORIGINAL Bad-status check (before this exclusion existed) still lives at
    the `apply_features` level in `test_feature_quirks.py`.
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
    # frame()'s TI-101 is [70, 71, 0(Bad), 73, 74, 75] + 1 each; the Bad row
    # (index 2) is dropped entirely, not laundered — 5 values, not 6.
    assert list(written["c0_plus_1"]) == [71.0, 72.0, 74.0, 75.0, 76.0]
    assert result["dropped_bad_rows"] == 1


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


# --- DS-LAKE-022-T02: the split, and what it makes provable -----------------


def test_features_scale_false_skips_scaling_and_leaves_bad_cells_bad() -> None:
    """The precondition itself: with `scale=False`, `features()` must stop
    after selectColumns. frame()'s Bad row (index 2, TI-101=0.0) must survive
    AS Bad — under the old always-scale behaviour `to_model_ready` would force
    it Good, which is exactly the laundering that makes cleaning-after-features
    a no-op."""
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/silver2-id/data.parquet",
            features=[],
            scalers={"TI-101": "minmax"},
            scale=False,
        ),
    )

    assert result["feature_spec_key"] is None
    written = store.objects["ds-1/artifacts/silver2-id/data.parquet"]
    assert list(written["TI-101"]) == [70.0, 71.0, 0.0, 73.0, 74.0, 75.0]
    assert list(written["TI-101__status"]) == [
        STATUS_GOOD, STATUS_GOOD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD,
    ]
    assert "ds-1/artifacts/silver2-id/feature_spec.json" not in store.documents


def test_features_scale_true_default_is_byte_identical_to_before_the_split() -> None:
    """Every existing caller passes no `scale` field at all — the default
    must reproduce today's combined write exactly, or this split silently
    changes production behaviour on day one.

    CORRECTED (DS-LAKE-023-T05): "before the split" now also means "before
    `drop_bad_feature_rows` existed" — this used to assert 6 STATUS_GOOD
    rows (the Bad row laundered, not excluded). The Bad row is now dropped
    before scaling, so only 5 rows remain, all Good.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            scalers={"TI-101": "minmax"},
        ),
    )
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    assert list(written["TI-101__status"]) == [STATUS_GOOD] * 5
    assert result["feature_spec_key"] == "ds-1/artifacts/gold-id/feature_spec.json"
    assert result["dropped_bad_rows"] == 1


def test_scale_writes_feature_spec_and_forces_good() -> None:
    """`scale()` is the new home for the toModelReady tail: it must scale and
    write feature_spec.json exactly as the old combined `features()` did."""
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.scale(
        store,
        ScaleRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            scalers={"TI-101": "minmax"},
        ),
    )

    assert result["feature_spec_key"] == "ds-1/artifacts/gold-id/feature_spec.json"
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    # CORRECTED (DS-LAKE-023-T05): 5 rows, not 6 — see the same correction on
    # test_features_scale_true_default_is_byte_identical_to_before_the_split.
    assert list(written["TI-101__status"]) == [STATUS_GOOD] * 5
    assert result["dropped_bad_rows"] == 1
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    # CORRECTED (DS-LAKE-023-T05): the fitted min used to be 0.0 — the Bad
    # cell's 0.0 was still finite and entered the scaler's own statistics.
    # `scale()` now excludes that row before fitting, same as `features()`.
    assert spec["scalingParams"] == {"TI-101": {"min": 70.0, "max": 75.0}}


def test_scale_excludes_bad_feature_rows_instead_of_scoring_scaled_zeros() -> None:
    """DS-LAKE-023-T05-V05, the TRAIN-side mirror of
    `test_prepare_excludes_bad_feature_rows_instead_of_scoring_scaled_zeros`
    (test_artifact_service_prepare_holdout.py). A sensor dropout long enough
    to make a `rolling(60)` column Bad must be EXCLUDED from the train frame
    too, not scaled into a plausible 0.0 and stamped Good — D5's own "both
    sides" decision, not just the holdout.
    """
    frame_with_dropout = _daily_frame(6)
    frame_with_dropout["roll60_mean"] = [10.0, 20.0, 0.0, 0.0, 50.0, 60.0]
    frame_with_dropout["roll60_mean__status"] = pd.array(
        [STATUS_GOOD, STATUS_GOOD, STATUS_BAD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD],
        dtype="int8",
    )
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame_with_dropout})

    result = artifact_service.scale(
        store,
        ScaleRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            scalers={"TI-101": "minmax", "roll60_mean": "minmax"},
        ),
    )

    assert result["dropped_bad_rows"] == 2
    written = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    assert len(written) == 4
    assert written["timestamp"].tolist() == list(
        frame_with_dropout["timestamp"].iloc[[0, 1, 4, 5]]
    )
    assert list(written["roll60_mean__status"]) == [STATUS_GOOD] * 4


def test_reorder_v01_cleaning_between_features_and_scale_actually_removes_bad_rows() -> None:
    """DS-LAKE-022-V01. Under the OLD order (features() with scale=True, the
    only path that existed before this task) the Bad row is laundered to Good
    before any cleaning could run, so a drop_missing op downstream would have
    nothing left to drop. Under the NEW order — features(scale=False) ->
    clean() -> scale() — the Bad row is still Bad when clean() sees it and is
    actually removed. A test that only asserted 'scale() succeeded' would pass
    against the exact defect this feature exists to remove; this asserts the
    row count.
    """
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})

    # New order, step 1: feature stage only, Bad cell survives (proven above).
    artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/silver2-id/data.parquet",
            features=[],
            scale=False,
        ),
    )
    assert len(store.objects["ds-1/artifacts/silver2-id/data.parquet"]) == 6

    # New order, step 2: clean drops the still-Bad row.
    clean_result = artifact_service.clean(
        store,
        CleanRequest(
            source_key="ds-1/artifacts/silver2-id/data.parquet",
            target_key="ds-1/artifacts/cleaned-id/data.parquet",
            operations=[CleaningOperation(type="drop_missing", tags=["TI-101"])],
        ),
    )
    assert clean_result["row_count"] == 5
    cleaned = store.objects["ds-1/artifacts/cleaned-id/data.parquet"]
    assert list(cleaned["TI-101"]) == [70.0, 71.0, 73.0, 74.0, 75.0]

    # New order, step 3: scale the cleaned frame.
    artifact_service.scale(
        store,
        ScaleRequest(
            source_key="ds-1/artifacts/cleaned-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            scalers={"TI-101": "minmax"},
        ),
    )
    gold = store.objects["ds-1/artifacts/gold-id/data.parquet"]
    assert len(gold) == 5
    assert list(gold["TI-101__status"]) == [STATUS_GOOD] * 5


def test_reorder_v04_scaling_params_differ_between_old_and_new_order() -> None:
    """DS-LAKE-022-V04, the unfalsifiability check. Same recipe, same source
    frame — old order scales BEFORE cleaning ever could, new order cleans
    first. If the fitted min/max agree, cleaning did not actually run before
    scaling and the split accomplished nothing.

    CORRECTED (DS-LAKE-023-T05): the ORIGINAL version of this test proved the
    split mattered using only the Bad row's 0.0 dragging the old order's
    fitted min down to 0.0. `drop_bad_feature_rows` now excludes that same
    row BEFORE scaling on BOTH orders alike (T05 fixes the defect
    unconditionally, not just for the reordered path), so old and new order
    would now agree on min=70.0 if that were the only difference tested —
    correctly proving nothing about the REORDER anymore, only about T05. The
    new order's own CLEANING pipeline gains a real `clip` op (max=74.0) the
    old order never runs at all, so the two orders still provably diverge on
    a value T05 does not already handle.
    """
    old_store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    old = artifact_service.features(
        old_store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            scalers={"TI-101": "minmax"},
        ),
    )
    old_spec = old_store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    # DS-LAKE-023-T05 fixes the Bad-row-drags-the-min defect on BOTH orders
    # alike — the real 70.0, not the hole's 0.0, same as
    # test_features_writes_the_real_fitted_scaling_params.
    assert old_spec["scalingParams"]["TI-101"]["min"] == 70.0

    new_store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    artifact_service.features(
        new_store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/silver2-id/data.parquet",
            features=[],
            scale=False,
        ),
    )
    artifact_service.clean(
        new_store,
        CleanRequest(
            source_key="ds-1/artifacts/silver2-id/data.parquet",
            target_key="ds-1/artifacts/cleaned-id/data.parquet",
            operations=[
                CleaningOperation(type="drop_missing", tags=["TI-101"]),
                # Real cleaning `drop_bad_feature_rows` cannot substitute for
                # — a value transform, not a Bad-row exclusion. This is what
                # keeps this test meaningful post-T05: the old order never
                # runs it at all.
                CleaningOperation(type="clip", tags=["TI-101"], max=74.0),
            ],
        ),
    )
    new_result = artifact_service.scale(
        new_store,
        ScaleRequest(
            source_key="ds-1/artifacts/cleaned-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            scalers={"TI-101": "minmax"},
        ),
    )
    new_spec = new_store.documents[new_result["feature_spec_key"]]

    assert new_spec["scalingParams"]["TI-101"] != old_spec["scalingParams"]["TI-101"]
    # Concretely: the clip pulled the fitted max down to 74.0.
    assert new_spec["scalingParams"]["TI-101"] == {"min": 70.0, "max": 74.0}


def test_features_holdout_none_is_byte_identical_to_before_the_holdout_param() -> None:
    """DS-LAKE-023-T01. Every existing caller omits `holdout` — this must
    stay a true no-op: no validate sidecar written, no validation_* fields
    populated."""
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": frame()})
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
        ),
    )
    assert result["validation_row_count"] is None
    assert result["validation_holdout_from"] is None
    assert result["validation_missing_pct"] is None
    assert store.writes == ["ds-1/artifacts/gold-id/data.parquet"]


def test_features_holdout_v01_carries_real_computed_feature_values() -> None:
    """DS-LAKE-023-V01. Assert the holdout's FIRST row has REAL lag/rolling
    values equal to what the continuous pre-split frame produces at that
    same timestamp — not merely that the columns exist. `_daily_frame`'s
    TI-101 is valued 0..days-1, so lag/rolling values are checkable exactly.

    days 0..19. Holdout = day15..day19 (trailing). At day15: lag(5) reads
    day10 -> 10.0. rolling(window=6, mean) reads days[10..15] -> mean =
    (10+11+12+13+14+15)/6 = 12.5. A split that produced these columns
    all-Bad (the old lead-in mechanism's whole reason to exist) would fail
    this, not just an "columns present" check.
    """
    store = RecordingStore({
        "ds-1/artifacts/silver-id/data.parquet": _daily_frame(20)
    })
    result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=5),
                FeatureConfigRequest(
                    id="f2", kind="rolling", tag="TI-101", window=6, agg="mean"
                ),
            ],
            scale=False,
            holdout=HoldoutSplitRequest(
                from_time="2026-01-16", to_time="2026-01-20"
            ),
        ),
    )
    validate = store.objects["ds-1/artifacts/gold-id/validate_data.parquet"]
    first = validate.iloc[0]
    assert first["timestamp"] == pd.Timestamp("2026-01-16")  # day15
    assert first["TI-101__lag5"] == 10.0
    assert first["TI-101__lag5__status"] == STATUS_GOOD
    assert first["TI-101__roll6_mean"] == 12.5
    assert first["TI-101__roll6_mean__status"] == STATUS_GOOD
    assert result["validation_row_count"] == len(validate)
    assert result["validation_holdout_from"] == "2026-01-16 00:00:00"


def test_features_holdout_v02_no_lead_in_rows_leak_into_validate() -> None:
    """DS-LAKE-023-V02. Every timestamp in the holdout sidecar must fall
    inside the chosen window — `_split_holdout` is shared with the legacy
    BRONZE-stage path and copies `HOLDOUT_LEAD_IN` (7 days) by default, so a
    forgotten `lead_in=timedelta(0)` at this NEW call site would silently
    put training rows into the scored set. Confirmed two ways: through
    `features()` itself, and directly against `_split_holdout` at both
    `lead_in` values to pin the exact row-count difference lead-in would
    have caused.
    """
    src = _daily_frame(20)
    store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": src})
    artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[],
            scale=False,
            holdout=HoldoutSplitRequest(
                from_time="2026-01-16", to_time="2026-01-20"
            ),
        ),
    )
    validate = store.objects["ds-1/artifacts/gold-id/validate_data.parquet"]
    assert (validate["timestamp"] >= pd.Timestamp("2026-01-16")).all()
    assert len(validate) == 5  # day15..day19, no lead-in

    holdout = HoldoutSplitRequest(from_time="2026-01-16", to_time="2026-01-20")
    _, with_lead_in = artifact_service._split_holdout(src, holdout)
    _, without_lead_in = artifact_service._split_holdout(
        src, holdout, lead_in=timedelta(0))
    assert len(with_lead_in) == 12  # 7 lead-in days + 5 holdout days
    assert len(without_lead_in) == 5


def test_features_holdout_v03_mid_window_seam_has_no_boundary_artifact() -> None:
    """DS-LAKE-023-V03. A MID-WINDOW holdout (day10..day12) is the only case
    that can distinguish the fix from the old defect: a TRAILING holdout
    leaves train as one contiguous block, so both orders would agree.

    Under the reordered features-stage split, lag(1) at day13 (the first
    train row after the cut) is computed on the CONTINUOUS 20-day frame
    BEFORE the cut, so it correctly reads day12's value (12.0) — the same
    value production would see if day13 arrived as new data with day12 in
    its recent history. Contrast with the OLD order (split at BRONZE,
    features computed AFTER on the now-discontiguous train frame): day13
    becomes the new row immediately following day9 once days 10-12 are
    removed and the frame is reindexed, so its lag(1) would read day9's
    value (9.0) instead — a genuine wrong number, not a lead-in gap.
    """
    src = _daily_frame(20)

    # NEW order: split happens inside features(), after lag is computed on
    # the continuous frame.
    new_store = RecordingStore({"ds-1/artifacts/silver-id/data.parquet": src})
    artifact_service.features(
        new_store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=1),
            ],
            scale=False,
            holdout=HoldoutSplitRequest(
                from_time="2026-01-11", to_time="2026-01-13"  # day10..day12
            ),
        ),
    )
    new_train = new_store.objects["ds-1/artifacts/gold-id/data.parquet"]
    day13_new = new_train[new_train["timestamp"] == pd.Timestamp("2026-01-14")]
    assert day13_new.iloc[0]["TI-101__lag1"] == 12.0

    # OLD order, reproduced directly: split the raw frame FIRST (as
    # `materialize` does today), THEN compute features on the resulting
    # discontiguous train frame — the exact sequence this feature replaces.
    old_holdout = HoldoutSplitRequest(from_time="2026-01-11", to_time="2026-01-13")
    old_train_raw, _ = artifact_service._split_holdout(
        src, old_holdout, lead_in=timedelta(0))
    old_store = RecordingStore({
        "ds-1/artifacts/bronze-id/data.parquet": old_train_raw
    })
    artifact_service.features(
        old_store,
        FeaturesRequest(
            source_key="ds-1/artifacts/bronze-id/data.parquet",
            target_key="ds-1/artifacts/gold-id/data.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=1),
            ],
            scale=False,
        ),
    )
    old_train = old_store.objects["ds-1/artifacts/gold-id/data.parquet"]
    day13_old = old_train[old_train["timestamp"] == pd.Timestamp("2026-01-14")]
    assert day13_old.iloc[0]["TI-101__lag1"] == 9.0  # the defect this fixes


def test_features_holdout_refuses_a_window_matching_no_rows() -> None:
    """Mirrors `materialize`'s own guard: a holdout with no matching rows
    must fail loud, not commit a 0-row validate sidecar silently."""
    store = RecordingStore({
        "ds-1/artifacts/silver-id/data.parquet": _daily_frame(20)
    })
    with pytest.raises(ValueError, match="matched no rows"):
        artifact_service.features(
            store,
            FeaturesRequest(
                source_key="ds-1/artifacts/silver-id/data.parquet",
                target_key="ds-1/artifacts/gold-id/data.parquet",
                features=[],
                scale=False,
                holdout=HoldoutSplitRequest(
                    from_time="2027-01-01", to_time="2027-01-02"
                ),
            ),
        )
