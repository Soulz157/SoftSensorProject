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
