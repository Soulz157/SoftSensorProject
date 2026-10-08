"""DS-LAKE-023-T03: `artifact_service.prepare_holdout_for_run` — the
SILVER-branch scoring path for a holdout produced by the reordered
features-stage split (T01), as opposed to `replay_holdout_for_run`'s
BRONZE-branch replay.

Same reasoning as `test_artifact_service_replay_holdout.py`: storage is
faked (`RecordingStore`), never skipped.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from schemas.preprocess import PrepareHoldoutForRunRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, _daily_frame


def _frame_with_a_rolling_dropout() -> pd.DataFrame:
    """DS-LAKE-023-T05-V05. 6 days, `TI-101` clean throughout, plus a
    `roll60_mean` column (standing in for a real `rolling(60)` feature
    without needing 60 real rows) that is Bad on exactly 2 of them — the
    shape a real sensor dropout leaves: `_compute_feature_column`'s own
    "rolling needs a FULL window of Good source values" rule marks every
    row whose window straddled the gap as Bad, not just the gap itself.
    """
    frame = _daily_frame(6)
    frame["roll60_mean"] = [10.0, 20.0, 0.0, 0.0, 50.0, 60.0]
    frame["roll60_mean__status"] = pd.array(
        [STATUS_GOOD, STATUS_GOOD, STATUS_BAD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD],
        dtype="int8",
    )
    return frame


def _seed_feature_spec(store: RecordingStore, key: str, **overrides) -> None:
    spec = {
        "featureVersion": 2,
        "features": [],
        "selectedColumns": ["TI-101"],
        "scaling": [{"tag": "TI-101", "method": "minmax"}],
        "scalingParams": {"TI-101": {"min": 0.0, "max": 100.0}},
        "encoding": [],
        "featureHash": "irrelevant-to-this-test",
    }
    spec.update(overrides)
    store.put_json(key, spec)


def test_prepare_scales_with_recorded_params_not_a_fresh_fit() -> None:
    """T02/T01's own proof, one layer up: `scalingParams` read off the
    feature_spec.json sidecar must be SUPPLIED to `to_model_ready`, not
    re-fit on the holdout's own (much narrower) range."""
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": _daily_frame(10)[7:10].reset_index(drop=True)
    })
    _seed_feature_spec(store, "ds-1/artifacts/gold-1/feature_spec.json")

    artifact_service.prepare_holdout_for_run(
        store,
        PrepareHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/silver-1/validate_data.parquet",
            target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
        ),
    )
    written = store.objects["ds-1/artifacts/silver-1/validate_ready.parquet"]

    # (v - 0) / (100 - 0) — self-fitting against [7.0, 9.0]'s own min/max
    # would make day7 read 0.0, not 0.07.
    assert written["TI-101"].tolist() == [0.07, 0.08, 0.09]


def test_prepare_runs_no_apply_features_no_select_columns() -> None:
    """The sidecar already carries its derived columns and selection — this
    function must not re-derive or re-select anything. Proven by seeding a
    frame whose columns do NOT match `selectedColumns`/`features` at all and
    confirming nothing raises and the extra column survives untouched."""
    import pandas as pd
    from intergrations.object_store import STATUS_GOOD

    frame = _daily_frame(3)
    frame["EXTRA"] = [1.0, 2.0, 3.0]
    frame["EXTRA__status"] = pd.array([STATUS_GOOD] * 3, dtype="int8")
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": frame
    })
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        features=[{"name": "SOMETHING_NOT_IN_THE_FRAME", "kind": "lag", "config": {}}],
        selectedColumns=["TI-101"],  # deliberately excludes EXTRA
        # Both tags "none" — this test is about apply_features/select_columns
        # NOT running, not about the coverage guard (covered separately).
        scaling=[{"tag": "TI-101", "method": "none"}, {"tag": "EXTRA", "method": "none"}],
        scalingParams={},
    )

    artifact_service.prepare_holdout_for_run(
        store,
        PrepareHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/silver-1/validate_data.parquet",
            target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
        ),
    )
    written = store.objects["ds-1/artifacts/silver-1/validate_ready.parquet"]
    # EXTRA survives — select_columns was never called to drop it.
    assert "EXTRA" in written.columns
    assert written["EXTRA"].tolist() == [1.0, 2.0, 3.0]


def test_prepare_refuses_when_the_recorded_target_is_scaled() -> None:
    """Mirrors `replay_holdout_for_run`'s own refusal — a target the trainer
    would never inverse-transform must not silently produce a holdout score
    either."""
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": _daily_frame(3)
    })
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        target_y="TI-101",
        target_scaled=True,
    )

    with pytest.raises(ValueError, match="scaled"):
        artifact_service.prepare_holdout_for_run(
            store,
            PrepareHoldoutForRunRequest(
                feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
                source_key="ds-1/artifacts/silver-1/validate_data.parquet",
                target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
            ),
        )
    assert store.writes == [], "a refused prepare must write nothing"


def test_prepare_refuses_a_scaled_tag_with_no_recorded_params() -> None:
    """DS-LAKE-023-T03's own coverage guard, NEW versus replay_holdout_for_run:
    a scaler dict claiming TI-101 should be minmax-scaled, but with no entry
    for it in scalingParams, would otherwise reach `to_model_ready` and
    silently re-fit on the holdout's own statistics — exactly the wrongness
    supplied params exist to prevent. Must refuse loudly instead."""
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": _daily_frame(3)
    })
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        scaling=[{"tag": "TI-101", "method": "minmax"}],
        scalingParams={},  # missing entirely
    )

    with pytest.raises(ValueError, match="TI-101"):
        artifact_service.prepare_holdout_for_run(
            store,
            PrepareHoldoutForRunRequest(
                feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
                source_key="ds-1/artifacts/silver-1/validate_data.parquet",
                target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
            ),
        )
    assert store.writes == [], "a refused prepare must write nothing"


def test_prepare_allows_a_none_scaled_tag_with_no_recorded_params() -> None:
    """The coverage guard must NOT flag a tag whose method is 'none' —
    `_scale_column`'s own early return never fits anything for it, so there
    is nothing to have recorded."""
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": _daily_frame(3)
    })
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        scaling=[{"tag": "TI-101", "method": "none"}],
        scalingParams={},
    )

    artifact_service.prepare_holdout_for_run(
        store,
        PrepareHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/silver-1/validate_data.parquet",
            target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
        ),
    )
    written = store.objects["ds-1/artifacts/silver-1/validate_ready.parquet"]
    assert written["TI-101"].tolist() == [0.0, 1.0, 2.0]  # unchanged


def test_prepare_excludes_bad_feature_rows_instead_of_scoring_scaled_zeros() -> None:
    """DS-LAKE-023-T05-V05. A sensor dropout long enough to make a
    `rolling(60)` column Bad must be EXCLUDED and COUNTED, not scaled into a
    plausible-looking 0.0 and stamped Good — the exact failure this task
    exists to fix (module docstring on `drop_bad_feature_rows`). A holdout
    with clean data cannot distinguish a working exclusion from none, which
    is why this dedicated dropout fixture exists rather than reusing
    `_daily_frame` alone.
    """
    store = RecordingStore({
        "ds-1/artifacts/silver-1/validate_data.parquet": _frame_with_a_rolling_dropout()
    })
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        selectedColumns=["TI-101", "roll60_mean"],
        scaling=[
            {"tag": "TI-101", "method": "minmax"},
            {"tag": "roll60_mean", "method": "minmax"},
        ],
        scalingParams={
            "TI-101": {"min": 0.0, "max": 100.0},
            "roll60_mean": {"min": 0.0, "max": 100.0},
        },
    )

    result = artifact_service.prepare_holdout_for_run(
        store,
        PrepareHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/silver-1/validate_data.parquet",
            target_key="ds-1/artifacts/silver-1/validate_ready.parquet",
        ),
    )

    # Counted, not silently absorbed — a score computed over an unstated
    # subset is not comparable to anything (this function's own docstring).
    assert result["dropped_bad_rows"] == 2

    written = store.objects["ds-1/artifacts/silver-1/validate_ready.parquet"]
    # 4 rows survive (day0, day1, day4, day5) — the two Bad rows (day2, day3)
    # are GONE, not present as a scaled 0.0 stamped Good.
    assert len(written) == 4
    assert written["timestamp"].tolist() == list(
        _daily_frame(6)["timestamp"].iloc[[0, 1, 4, 5]]
    )
    # Every surviving row's roll60_mean really was Good BEFORE scaling —
    # to_model_ready force-stamps Good regardless, so the row count above is
    # what actually proves the exclusion ran, not this line alone.
    assert list(written["roll60_mean__status"]) == [STATUS_GOOD] * 4
