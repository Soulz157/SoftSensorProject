"""MODEL-SERVE-015-T03/T04. `artifact_service.combine_for_retrain` and its
companion `passthrough_holdout_for_run`.

Same reasoning as `test_artifact_service_prepare_holdout.py`: storage is
faked (`RecordingStore`), never skipped — the whole point of this feature is
that the base FINAL's own rows are used AS-IS (no re-scale) while only the
new dataset's rows are transformed, and that is exactly the kind of thing a
mocked-out `to_model_ready` would hide.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import STATUS_GOOD
from schemas.preprocess import CombineForRetrainRequest, PassthroughHoldoutForRunRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, _daily_frame


def _seed_feature_spec(store: RecordingStore, key: str, **overrides) -> None:
    spec = {
        "featureVersion": 2,
        "features": [],
        "selectedColumns": ["TI-101"],
        "target_y": "TI-101",
        "target_scaled": False,
        "scaling": [{"tag": "TI-101", "method": "minmax"}],
        "scalingParams": {"TI-101": {"min": 0.0, "max": 19.0}},
        "encoding": [],
        "featureHash": "irrelevant-to-this-test",
    }
    spec.update(overrides)
    store.put_json(key, spec)


def test_combine_keeps_base_rows_untouched_and_scales_only_new_rows() -> None:
    """The core double-scale guard this feature exists to prove: base rows
    (days 0-14, ALREADY "scaled" — just plain floats here, the test cares
    only that they pass through byte-identical) must not be transformed at
    all, while the new dataset's own rows (raw) must be scaled with the
    base's RECORDED params, never re-fit on the new rows' own (much
    narrower) range.

    Uses a SEPARATE feature tag (`PT-201`) for the scaled values — `TI-101`
    is the target, and the target must never be scaled (`_scalable_tags`'s
    own invariant), so asserting on it here would prove nothing either way.
    """
    base = _daily_frame(20)  # day0 (2026-01-01) .. day19 (2026-01-20)
    base["PT-201"] = [float(i) for i in range(20)]
    base["PT-201__status"] = base["TI-101__status"]
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")
    new["PT-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    new["PT-201__status"] = new["TI-101__status"]

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
        # A real spec always carries an explicit "none" entry for the
        # target — `assert_scaling_coverage` treats an ABSENT tag as
        # defaulting to "minmax" (`to_model_ready`'s own default lookup),
        # so an omitted target would be flagged as an unrecorded SCALED tag
        # rather than recognised as deliberately unscaled.
        scaling=[
            {"tag": "PT-201", "method": "minmax"},
            {"tag": "TI-101", "method": "none"},
        ],
        scalingParams={"PT-201": {"min": 0.0, "max": 19.0}},
    )

    result = artifact_service.combine_for_retrain(
        store,
        CombineForRetrainRequest(
            base_data_key="base-ds/artifacts/final-1/data.parquet",
            base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
            new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
            target_key="base-ds/artifacts/combined-1/data_gold.parquet",
            target_y="TI-101",
            # day15 (2026-01-16) — base_train = day0-14, base_frozen = day15-19.
            cut_timestamp="2026-01-16",
        ),
    )

    written = store.objects["base-ds/artifacts/combined-1/data_gold.parquet"]
    assert len(written) == 15 + 5  # base_train (15) + all 5 new rows

    # Base rows (day0-14, PT-201 values 0.0-14.0) survive BYTE-IDENTICAL —
    # no to_model_ready call touched them.
    base_rows = written[written["timestamp"] < pd.Timestamp("2026-01-16")]
    assert sorted(base_rows["PT-201"].tolist()) == [float(i) for i in range(15)]

    # New rows (100-104) ARE scaled, with the RECORDED params (min=0,max=19)
    # — self-fitting on [100,104]'s own range would produce a completely
    # different set of numbers.
    new_rows = written[written["timestamp"] >= pd.Timestamp("2026-01-26")]
    expected = [round(v / 19.0, 3) for v in [100.0, 101.0, 102.0, 103.0, 104.0]]
    assert sorted(new_rows["PT-201"].tolist()) == sorted(expected)

    # The re-cut frozen-eval slice (day15-19, values 15-19, untouched) landed
    # at the combined artifact's own validate_data.parquet sidecar.
    frozen = store.objects["base-ds/artifacts/combined-1/validate_data.parquet"]
    assert sorted(frozen["TI-101"].tolist()) == [15.0, 16.0, 17.0, 18.0, 19.0]

    assert result["validation_row_count"] == 5
    assert result["frozen_eval_checksum"]
    assert result["base_train_row_count"] == 15
    assert result["new_train_row_count"] == 5
    assert result["dedupe_dropped"] == 0
    # The copied recipe, not a re-derived one — same feature_spec.json the
    # base artifact recorded.
    assert result["feature_spec_key"] == (
        "base-ds/artifacts/combined-1/feature_spec.json"
    )


def test_new_data_only_trains_on_new_rows_but_keeps_the_base_frozen_window() -> None:
    """MODEL-SERVE-017. `combine=False` is the "New Data Only" strategy.

    Two things must hold at once, and they pull in opposite directions:
    the base's TRAIN rows must be absent from the written artifact, while
    the base's FROZEN rows must still be written to the sidecar — dropping
    those too would leave a New-Data-Only candidate with nothing to be
    scored against the incumbent on, which is the whole basis of the
    comparison.

    The new rows must also still be scaled with the BASE's recorded params,
    exactly as in the combine case: `combine=False` changes which rows are
    trained on, never the feature space they live in.
    """
    base = _daily_frame(20)
    base["PT-201"] = [float(i) for i in range(20)]
    base["PT-201__status"] = base["TI-101__status"]
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")
    new["PT-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    new["PT-201__status"] = new["TI-101__status"]

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
        scaling=[
            {"tag": "PT-201", "method": "minmax"},
            {"tag": "TI-101", "method": "none"},
        ],
        scalingParams={"PT-201": {"min": 0.0, "max": 19.0}},
    )

    result = artifact_service.combine_for_retrain(
        store,
        CombineForRetrainRequest(
            base_data_key="base-ds/artifacts/final-1/data.parquet",
            base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
            new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
            target_key="base-ds/artifacts/newonly-1/data_gold.parquet",
            target_y="TI-101",
            cut_timestamp="2026-01-16",
            combine=False,
        ),
    )

    written = store.objects["base-ds/artifacts/newonly-1/data_gold.parquet"]
    # The new rows ALONE — 15 base train rows deliberately left out.
    assert len(written) == 5
    assert written["timestamp"].min() == pd.Timestamp("2026-01-26")

    # Still the base's recorded params (min=0, max=19), not re-fit on
    # [100,104] — identical to the combine case's expectation.
    expected = [round(v / 19.0, 3) for v in [100.0, 101.0, 102.0, 103.0, 104.0]]
    assert sorted(written["PT-201"].tolist()) == sorted(expected)

    # The frozen evaluation slice is the BASE's own test rows, unchanged —
    # this is what the candidate gets scored on.
    frozen = store.objects["base-ds/artifacts/newonly-1/validate_data.parquet"]
    assert sorted(frozen["TI-101"].tolist()) == [15.0, 16.0, 17.0, 18.0, 19.0]

    assert result["validation_row_count"] == 5
    assert result["frozen_eval_checksum"]
    # Reports rows that actually reached training, so no base rows did.
    assert result["base_train_row_count"] == 0
    assert result["new_train_row_count"] == 5


def test_combine_allows_a_spec_that_never_recorded_params_for_the_target() -> None:
    """Reported from live use: a retrain refused with

        Scaling refused: ['S204IBP.lab'] would scale without a recorded
        scalingParams entry ...

    where that tag is the TARGET.

    The target is never scaled — `_scalable_tags` exists precisely to keep it
    out of `to_model_ready`, and both this function and
    `prepare_holdout_for_run` refuse outright when `target_scaled` is set. So
    a spec has no reason to carry `scalingParams` for it, and a correct spec
    written after MODEL-SERVE-010-T05 does not.

    The coverage assert was nonetheless handed EVERY tag, including the
    target. `assert_scaling_coverage` treats a tag absent from `scaling` as
    defaulting to minmax, so the target read as "would be scaled, with no
    recorded params" and the whole retrain was refused over a column the very
    next line declines to scale.

    The spec here is the real-world shape the guard's own docstring
    describes — "all have `scaling: []` while `scalingParams` is fully
    populated" — with no entry of any kind for the target.
    """
    base = _daily_frame(20)
    base["PT-201"] = [float(i) for i in range(20)]
    base["PT-201__status"] = base["TI-101__status"]
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")
    new["PT-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    new["PT-201__status"] = new["TI-101__status"]

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
        # No "none" row for TI-101, and no scalingParams entry for it —
        # exactly what a spec looks like when the target was correctly never
        # scaled.
        scaling=[{"tag": "PT-201", "method": "minmax"}],
        scalingParams={"PT-201": {"min": 0.0, "max": 19.0}},
    )

    result = artifact_service.combine_for_retrain(
        store,
        CombineForRetrainRequest(
            base_data_key="base-ds/artifacts/final-1/data.parquet",
            base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
            new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
            target_key="base-ds/artifacts/combined-2/data_gold.parquet",
            target_y="TI-101",
            cut_timestamp="2026-01-16",
        ),
    )

    written = store.objects["base-ds/artifacts/combined-2/data_gold.parquet"]
    assert len(written) == 15 + 5

    # The target came through in ENGINEERING UNITS, unscaled — the guard was
    # wrong to refuse, and nothing scaled it once it stopped refusing.
    new_rows = written[written["timestamp"] >= pd.Timestamp("2026-01-26")]
    assert sorted(new_rows["TI-101"].tolist()) == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert result["new_train_row_count"] == 5


def test_combine_still_refuses_an_unrecorded_FEATURE_tag() -> None:
    """The guard must keep firing for a real feature.

    The fix above narrows the coverage check to the tags that actually get
    scaled; it must not disable it. A feature with no recorded params would
    be re-fit on this frame's own statistics — silently a different
    transform from the one the incumbent trained under.
    """
    base = _daily_frame(20)
    base["PT-201"] = [float(i) for i in range(20)]
    base["PT-201__status"] = base["TI-101__status"]
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")
    new["PT-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    new["PT-201__status"] = new["TI-101__status"]

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
        scaling=[{"tag": "PT-201", "method": "minmax"}],
        # PT-201 is scaled but has NO recorded params.
        scalingParams={},
    )

    with pytest.raises(ValueError, match="Scaling refused"):
        artifact_service.combine_for_retrain(
            store,
            CombineForRetrainRequest(
                base_data_key="base-ds/artifacts/final-1/data.parquet",
                base_feature_spec_key=(
                    "base-ds/artifacts/final-1/feature_spec.json"
                ),
                new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
                target_key="base-ds/artifacts/combined-3/data_gold.parquet",
                target_y="TI-101",
                cut_timestamp="2026-01-16",
            ),
        )


def test_combine_refuses_when_new_dataset_overlaps_the_frozen_window() -> None:
    """T02/T04's own leakage guard, re-verified against the real data: a new
    dataset starting AT OR BEFORE the incumbent's own split boundary would
    let the candidate train on rows adjacent to (or inside) its frozen
    evaluation window."""
    base = _daily_frame(20)
    new = base[15:18].reset_index(drop=True)  # day15-17 — squarely inside
    # the would-be frozen window (day15-19).

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(store, "base-ds/artifacts/final-1/feature_spec.json")

    with pytest.raises(ValueError, match="uncontaminated"):
        artifact_service.combine_for_retrain(
            store,
            CombineForRetrainRequest(
                base_data_key="base-ds/artifacts/final-1/data.parquet",
                base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
                new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
                target_key="base-ds/artifacts/combined-1/data_gold.parquet",
                target_y="TI-101",
                cut_timestamp="2026-01-16",
            ),
        )


def test_combine_refuses_on_tag_mismatch() -> None:
    base = _daily_frame(20)
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")
    # A second tag the base artifact never had.
    new["PT-201"] = [1.0, 2.0, 3.0, 4.0, 5.0]
    new["PT-201__status"] = pd.array([STATUS_GOOD] * 5, dtype="int8")

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
    )

    with pytest.raises(ValueError, match="tag columns"):
        artifact_service.combine_for_retrain(
            store,
            CombineForRetrainRequest(
                base_data_key="base-ds/artifacts/final-1/data.parquet",
                base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
                new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
                target_key="base-ds/artifacts/combined-1/data_gold.parquet",
                target_y="TI-101",
                cut_timestamp="2026-01-16",
            ),
        )


def test_combine_refuses_when_base_target_is_scaled() -> None:
    base = _daily_frame(20)
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(range(5), unit="D")

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store, "base-ds/artifacts/final-1/feature_spec.json", target_scaled=True
    )

    with pytest.raises(ValueError, match="no inverse transform"):
        artifact_service.combine_for_retrain(
            store,
            CombineForRetrainRequest(
                base_data_key="base-ds/artifacts/final-1/data.parquet",
                base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
                new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
                target_key="base-ds/artifacts/combined-1/data_gold.parquet",
                target_y="TI-101",
                cut_timestamp="2026-01-16",
            ),
        )


def test_passthrough_holdout_copies_without_any_transform() -> None:
    """MODEL-SERVE-015-T04. Proves the passthrough branch runs NO
    to_model_ready — a frame whose values are clearly out of [0,1] (so a
    minmax re-scale would visibly change them) must survive byte-identical."""
    frozen = _daily_frame(5)
    frozen["TI-101"] = [15.0, 16.0, 17.0, 18.0, 19.0]

    store = RecordingStore({
        "base-ds/artifacts/combined-1/validate_data.parquet": frozen,
    })

    result = artifact_service.passthrough_holdout_for_run(
        store,
        PassthroughHoldoutForRunRequest(
            source_key="base-ds/artifacts/combined-1/validate_data.parquet",
            target_key="models/model-1/runs/run-1/validate_ready.parquet",
        ),
    )

    written = store.objects["models/model-1/runs/run-1/validate_ready.parquet"]
    assert written["TI-101"].tolist() == [15.0, 16.0, 17.0, 18.0, 19.0]
    assert result["row_count"] == 5


def _combine_with_window(store: RecordingStore, **overrides):
    """The operator-defined new-data validation window, on the shared fixture
    below: base days 0-19, new days 2026-01-26..2026-01-30 (5 rows).
    """
    kwargs = dict(
        base_data_key="base-ds/artifacts/final-1/data.parquet",
        base_feature_spec_key="base-ds/artifacts/final-1/feature_spec.json",
        new_data_key="new-ds/artifacts/silver-1/data_silver.parquet",
        target_key="base-ds/artifacts/combined-1/data_gold.parquet",
        target_y="TI-101",
        cut_timestamp="2026-01-16",
    )
    kwargs.update(overrides)
    return artifact_service.combine_for_retrain(
        store, CombineForRetrainRequest(**kwargs)
    )


def _window_store() -> RecordingStore:
    base = _daily_frame(20)
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(
        range(5), unit="D")
    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(store, "base-ds/artifacts/final-1/feature_spec.json")
    return store


def test_new_validation_window_is_held_out_of_training() -> None:
    """THE leakage guard. The operator's window leaves the training frame
    entirely and lands in its OWN sidecar — a row may never be both trained
    on and validated on.

    Asserted on the frames themselves rather than on the reported counts,
    because a count can agree while the rows are still present.
    """
    store = _window_store()

    result = _combine_with_window(
        store,
        # The last two new days (29th, 30th).
        new_validation_from="2026-01-29",
        new_validation_to="2026-01-30",
    )

    written = store.objects["base-ds/artifacts/combined-1/data_gold.parquet"]
    held_out = store.objects[
        "base-ds/artifacts/combined-1/validate_new_data.parquet"]

    assert len(held_out) == 2
    # base_train (15) + the 3 new rows that were NOT held out.
    assert len(written) == 15 + 3

    # The decisive assertion: no timestamp appears on both sides.
    overlap = set(written["timestamp"]) & set(held_out["timestamp"])
    assert overlap == set()
    assert written["timestamp"].max() == pd.Timestamp("2026-01-28")

    assert result["new_validation_row_count"] == 2
    assert result["new_validation_checksum"]
    assert result["new_train_row_count"] == 3


def test_new_validation_window_leaves_the_frozen_eval_set_untouched() -> None:
    """The comparability invariant. `rmseDelta` is computed on the frozen
    incumbent-test slice; if this feature disturbed it, every retrain
    comparison would silently change meaning.
    """
    without = _window_store()
    _combine_with_window(without)
    baseline = without.objects[
        "base-ds/artifacts/combined-1/validate_data.parquet"]

    with_window = _window_store()
    _combine_with_window(
        with_window,
        new_validation_from="2026-01-29",
        new_validation_to="2026-01-30",
    )
    frozen = with_window.objects[
        "base-ds/artifacts/combined-1/validate_data.parquet"]

    pd.testing.assert_frame_equal(baseline, frozen)
    # And it is a DIFFERENT object from the new-data holdout.
    assert "base-ds/artifacts/combined-1/validate_new_data.parquet" in (
        with_window.objects
    )


def test_new_validation_rows_are_scaled_with_the_bases_pinned_params() -> None:
    """The holdout must go through the same transform as the training rows,
    with the base's RECORDED params — never re-fit on the window's own much
    narrower range, which would make its RMSE incomparable to anything.
    """
    base = _daily_frame(20)
    base["PT-201"] = [float(i) for i in range(20)]
    base["PT-201__status"] = base["TI-101__status"]
    new = _daily_frame(5)
    new["timestamp"] = pd.Timestamp("2026-01-26") + pd.to_timedelta(
        range(5), unit="D")
    new["PT-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    new["PT-201__status"] = new["TI-101__status"]

    store = RecordingStore({
        "base-ds/artifacts/final-1/data.parquet": base,
        "new-ds/artifacts/silver-1/data_silver.parquet": new,
    })
    _seed_feature_spec(
        store,
        "base-ds/artifacts/final-1/feature_spec.json",
        selectedColumns=["TI-101", "PT-201"],
        scaling=[
            {"tag": "PT-201", "method": "minmax"},
            {"tag": "TI-101", "method": "none"},
        ],
        scalingParams={"PT-201": {"min": 0.0, "max": 19.0}},
    )

    _combine_with_window(
        store,
        new_validation_from="2026-01-30",
        new_validation_to="2026-01-30",
    )

    held_out = store.objects[
        "base-ds/artifacts/combined-1/validate_new_data.parquet"]
    # 104.0 under the BASE's params (max=19), not self-fitted.
    assert held_out["PT-201"].tolist() == [round(104.0 / 19.0, 3)]


def test_new_validation_window_refusals() -> None:
    """Every refusal fires BEFORE anything is committed — a rejected window
    must not leave a half-written combined artifact behind.
    """
    # Half-open window: refused rather than guessed at.
    store = _window_store()
    with pytest.raises(ValueError, match="must be supplied together"):
        _combine_with_window(store, new_validation_from="2026-01-29")
    assert "base-ds/artifacts/combined-1/data_gold.parquet" not in store.objects

    # Reversed bounds.
    store = _window_store()
    with pytest.raises(ValueError, match="before it starts"):
        _combine_with_window(
            store,
            new_validation_from="2026-01-30",
            new_validation_to="2026-01-29",
        )

    # Outside the new dataset's real range — checked against the loaded
    # frame, never against a caller's assertion.
    store = _window_store()
    with pytest.raises(ValueError, match="falls outside the new dataset"):
        _combine_with_window(
            store,
            new_validation_from="2026-02-10",
            new_validation_to="2026-02-11",
        )

    # Covers every new row under New Data Only — nothing left to train on.
    store = _window_store()
    with pytest.raises(ValueError, match="nothing to train on"):
        _combine_with_window(
            store,
            combine=False,
            new_validation_from="2026-01-26",
            new_validation_to="2026-01-30",
        )
