"""DS-LAKE-018-T04: `artifact_service.replay_holdout` — the raw-holdout ->
model-ready replay endpoint.

Same reasoning as `test_artifact_service_features.py`: storage is faked
(`RecordingStore`), never skipped, so a guarantee here does not depend on
MinIO being reachable. `_daily_frame` (test_artifact_service.py, DS-LAKE-018-
T03) is reused rather than re-derived — a daily-spaced, value-equals-day-
index frame is exactly what makes lead-in/trim/lookback assertions checkable
by VALUE, not just row count.
"""

from __future__ import annotations

import pytest

from schemas.preprocess import (
    FeatureConfigRequest,
    FeaturesRequest,
    ReplayHoldoutForRunRequest,
    ReplayHoldoutRequest,
)
from services import artifact_service
from tests.test_artifact_service import RecordingStore, _daily_frame


def test_replay_refuses_when_captured_lead_in_is_shorter_than_the_recipe_needs() -> None:
    """lag(k=3) needs 3 rows before the holdout boundary. Only 2 are here
    (day5, day6) before day7 — a REFUSAL (422 via ValueError), not a warning,
    per the scope_note."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[5:10].reset_index(drop=True)}
    )
    with pytest.raises(ValueError, match=r"needs 3.*short by 1"):
        artifact_service.replay_holdout(
            store,
            ReplayHoldoutRequest(
                source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
                target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
                holdout_from="2026-01-08",  # day7
                features=[
                    FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=3)
                ],
            ),
        )
    assert store.writes == [], "a refused replay must write nothing"


def test_replay_succeeds_and_computes_real_lag_values_for_the_holdouts_own_first_row() -> None:
    """Exactly 3 rows of lead-in (day4,5,6) before the day7 holdout start —
    sufficient for lag(3). Proves the mechanism V04 will verify live: the
    holdout's FIRST scored row gets a REAL lag value, not null, because the
    lead-in rows were there to compute it from."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[4:10].reset_index(drop=True)}
    )
    result = artifact_service.replay_holdout(
        store,
        ReplayHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",  # day7
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=3)
            ],
            selected_columns=["TI-101__lag3"],
            # "none" — to_model_ready scales EVERY tag column by default
            # (DEFAULT_SCALER), and this test is about the LAG mechanism,
            # not scaling; an unscaled passthrough keeps the raw day-index
            # values directly assertable.
            scalers={"TI-101__lag3": "none"},
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]

    # Trimmed to the holdout window only — day7, day8, day9 (3 rows), NOT
    # the 6 rows the lead-in-inclusive source frame carried.
    assert result["row_count"] == 3
    assert len(written) == 3
    # day7's lag3 reads day4 (value 4.0); day8 reads day5; day9 reads day6.
    # None are null/Bad — the lead-in did its job.
    assert written["TI-101__lag3"].tolist() == [4.0, 5.0, 6.0]
    assert (written["TI-101__lag3__status"] == 0).all()  # STATUS_GOOD


def test_replay_scales_with_supplied_params_not_a_fresh_fit_on_the_holdout() -> None:
    """T02's own required proof, at the replay layer this time: supplied
    train-fitted params must produce a DIFFERENT — and specifically the
    SUPPLIED-transform — result than fitting fresh on the holdout's own
    (much narrower) range."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[7:10].reset_index(drop=True)}
    )
    # "Trained" on a much wider range than the holdout itself ever sees.
    train_params = {"TI-101": {"min": 0.0, "max": 100.0}}

    result = artifact_service.replay_holdout(
        store,
        ReplayHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",  # day7
            features=[],
            selected_columns=["TI-101"],
            scalers={"TI-101": "minmax"},
            scaling_params=train_params,
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]

    # (v - 0) / (100 - 0), NOT self-fit against [7.0, 9.0]'s own min/max —
    # self-fitting would make day7 read 0.0 (its own min), not 0.07.
    assert written["TI-101"].tolist() == [0.07, 0.08, 0.09]
    assert result["row_count"] == 3


def test_replay_keeps_the_target_column_through_selection() -> None:
    """`target_y` must survive `select_columns` even when not explicitly
    listed — same `force_keep_target` guarantee `features()` already gives
    the ORIGINAL GOLD build; the replayed holdout must match it column for
    column (AC: 'exactly the same columns, in the same order')."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[7:10].reset_index(drop=True)}
    )
    result = artifact_service.replay_holdout(
        store,
        ReplayHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",
            features=[],
            selected_columns=[],  # deliberately empty — target must still survive
            target_y="TI-101",
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]
    assert "TI-101" in written.columns
    assert result["row_count"] == 3


def test_replay_runs_no_cleaning_step_at_all() -> None:
    """RESOLVED user decision: the holdout stays fully raw. A Bad cell in
    the source must survive UNTOUCHED into the replayed frame — no
    apply_operations call exists in replay_holdout to fill/clip/drop it."""
    from intergrations.object_store import STATUS_BAD

    src = _daily_frame(10)[7:10].reset_index(drop=True)
    src.loc[0, "TI-101__status"] = STATUS_BAD
    store = RecordingStore({"ds-1/artifacts/bronze-1/validate_data.parquet": src})

    artifact_service.replay_holdout(
        store,
        ReplayHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",
            features=[],
            selected_columns=["TI-101"],
            # "none" passes the raw value through untouched — to_model_ready
            # scales every tag column by default otherwise, which would make
            # the assertion below about scaling, not about cleaning.
            scalers={"TI-101": "none"},
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]
    # `to_model_ready` forces status Good for every FINITE value regardless
    # of original status (its own documented quirk) — this assertion is
    # about the VALUE surviving unfilled, not the status bit.
    assert written["TI-101"].iloc[0] == 7.0


# ── DS-LAKE-018-T05: `replay_holdout_for_run` — reads an EXISTING GOLD's own
# feature_spec.json instead of the caller re-supplying the recipe ──────────


def _seed_feature_spec(store: RecordingStore, key: str, **overrides) -> None:
    spec = {
        "featureVersion": 2,
        "features": [
            {
                "name": "TI-101__lag3",
                "kind": "lag",
                # `build_feature_spec` (feature_spec_service.py) excludes
                # ONLY id/name from `config` — `kind` stays in there too,
                # redundantly alongside the top-level `kind` above. This
                # fixture mirrors that real shape exactly (a hand-written
                # fixture that dropped `kind` from `config` here is what let
                # a real reshape bug in `replay_holdout_for_run` pass
                # unnoticed until the V03 column-identity test, which builds
                # its feature_spec.json through the real function instead).
                "config": {"kind": "lag", "tag": "TI-101", "k": 3},
            }
        ],
        "selectedColumns": ["TI-101__lag3"],
        "scaling": [{"tag": "TI-101__lag3", "method": "none"}],
        "scalingParams": {},
        "encoding": [],
        "featureHash": "irrelevant-to-this-test",
    }
    spec.update(overrides)
    store.put_json(key, spec)


def test_replay_for_run_reshapes_the_condensed_feature_spec_and_replays_correctly() -> None:
    """The condensed `{name, kind, config}` shape `build_feature_spec` writes
    must reconstruct the EXACT same `FeatureConfigRequest` a direct
    `replay_holdout` call would take — proven by reusing T04's own lag-value
    assertion (day7's lag3 reads day4 = 4.0) through the reshape path."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[4:10].reset_index(drop=True)}
    )
    _seed_feature_spec(store, "ds-1/artifacts/gold-1/feature_spec.json")

    result = artifact_service.replay_holdout_for_run(
        store,
        ReplayHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",  # day7
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]

    assert result["row_count"] == 3
    assert written["TI-101__lag3"].tolist() == [4.0, 5.0, 6.0]


def test_replay_for_run_refuses_when_the_recorded_target_is_scaled() -> None:
    """Mirrors train.py's own refusal — a target the trainer would never
    inverse-transform must not silently produce a holdout score either."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[7:10].reset_index(drop=True)}
    )
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        target_y="TI-101",
        target_scaled=True,
    )

    with pytest.raises(ValueError, match="scaled"):
        artifact_service.replay_holdout_for_run(
            store,
            ReplayHoldoutForRunRequest(
                feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
                source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
                target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
                holdout_from="2026-01-08",
            ),
        )
    assert store.writes == [], "a refused replay must write nothing"


def test_replay_for_run_uses_the_recorded_scaling_params_not_a_fresh_fit() -> None:
    """T02/T04's own proof, one layer up: `scalingParams` read off the
    feature_spec.json sidecar must be SUPPLIED to `to_model_ready`, not
    re-fit on the holdout's own (much narrower) range."""
    store = RecordingStore(
        {"ds-1/artifacts/bronze-1/validate_data.parquet": _daily_frame(10)[7:10].reset_index(drop=True)}
    )
    _seed_feature_spec(
        store,
        "ds-1/artifacts/gold-1/feature_spec.json",
        features=[],
        selectedColumns=["TI-101"],
        scaling=[{"tag": "TI-101", "method": "minmax"}],
        scalingParams={"TI-101": {"min": 0.0, "max": 100.0}},
    )

    artifact_service.replay_holdout_for_run(
        store,
        ReplayHoldoutForRunRequest(
            feature_spec_key="ds-1/artifacts/gold-1/feature_spec.json",
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-08",
        ),
    )
    written = store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"]

    # (v - 0) / (100 - 0) — self-fitting against [7.0, 9.0]'s own min/max
    # would make day7 read 0.0, not 0.07.
    assert written["TI-101"].tolist() == [0.07, 0.08, 0.09]


def test_replay_for_run_produces_the_same_columns_in_the_same_order_as_the_gold() -> None:
    """DS-LAKE-018-V05. On a recipe with a derived feature, a selection AND
    a scaler, the replayed holdout's column list must be IDENTICAL — same
    columns, same order — to the GOLD `features()` itself would produce from
    that recipe. Both calls share the exact same feature/selected_columns/
    scalers triple, read from the SAME feature_spec.json `features()` wrote,
    so a divergence here would mean the reshape (`{name,kind,config}` ->
    `FeatureConfigRequest`) silently changed the recipe's shape."""
    store = RecordingStore(
        {"ds-1/artifacts/silver-1/data.parquet": _daily_frame(10)}
    )
    gold_result = artifact_service.features(
        store,
        FeaturesRequest(
            source_key="ds-1/artifacts/silver-1/data.parquet",
            target_key="ds-1/artifacts/gold-1/data_gold.parquet",
            features=[
                FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=2)
            ],
            selected_columns=["TI-101", "TI-101__lag2"],
            scalers={"TI-101": "minmax", "TI-101__lag2": "minmax"},
        ),
    )
    gold_columns = list(
        store.objects["ds-1/artifacts/gold-1/data_gold.parquet"].columns
    )

    # day6-day9: 3 rows of lead-in (day6,7,8) before the day9 holdout start —
    # sufficient for lag(2).
    store.objects["ds-1/artifacts/bronze-1/validate_data.parquet"] = _daily_frame(
        10
    )[6:10].reset_index(drop=True)

    artifact_service.replay_holdout_for_run(
        store,
        ReplayHoldoutForRunRequest(
            feature_spec_key=gold_result["feature_spec_key"],
            source_key="ds-1/artifacts/bronze-1/validate_data.parquet",
            target_key="ds-1/artifacts/bronze-1/validate_ready.parquet",
            holdout_from="2026-01-10",  # day9
        ),
    )
    replayed_columns = list(
        store.objects["ds-1/artifacts/bronze-1/validate_ready.parquet"].columns
    )

    assert replayed_columns == gold_columns
