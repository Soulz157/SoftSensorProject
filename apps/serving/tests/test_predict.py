"""MODEL-SERVE-002-T04/T06. Column-naming, coverage-guard refusal, and the
target-derived history guard — all against a trivial fitted model so the
result value itself is not the point.
"""

from __future__ import annotations

import pytest

from services.predict import (
    PredictError,
    assert_history_satisfies_target_derivation,
    required_history_rows,
    rows_to_predictions,
)


class _SumModel:
    """predict(X) = row sum — deterministic, no real fit needed for these tests."""

    def predict(self, X):
        return X.sum(axis=1).to_numpy()


def _descriptor(**overrides) -> dict:
    base = {
        "featureColumns": ["a", "b"],
        "scalers": {},
        "scalingParams": {
            "a": {"min": 0.0, "max": 10.0},
            "b": {"min": 0.0, "max": 10.0},
        },
        "derivedFromTarget": [],
    }
    base.update(overrides)
    return base


def test_missing_column_named_in_error() -> None:
    with pytest.raises(PredictError, match=r"\['b'\]"):
        rows_to_predictions(_SumModel(), _descriptor(), [{"a": 1.0}])


def test_coverage_guard_refuses_an_uncovered_feature_column() -> None:
    """The empty-scaling-array trap, reached from the predict side: a
    feature column with no scalingParams entry must refuse rather than
    silently re-fit on this single request's own statistics."""
    descriptor = _descriptor(scalingParams={"a": {"min": 0.0, "max": 10.0}})
    with pytest.raises(PredictError, match="b"):
        rows_to_predictions(_SumModel(), descriptor, [{"a": 1.0, "b": 2.0}])


def test_happy_path_scales_and_predicts() -> None:
    descriptor = _descriptor()
    predictions = rows_to_predictions(
        _SumModel(), descriptor, [{"a": 5.0, "b": 5.0}]
    )
    # minmax(5, 0, 10) = 0.5 for both columns -> sum = 1.0
    assert predictions == pytest.approx([1.0])


def test_column_order_is_enforced_regardless_of_request_key_order() -> None:
    descriptor = _descriptor()
    predictions = rows_to_predictions(
        _SumModel(), descriptor, [{"b": 10.0, "a": 0.0}]
    )
    assert predictions == pytest.approx([1.0])


def test_target_history_guard_passes_when_empty_derivation() -> None:
    assert_history_satisfies_target_derivation(_descriptor(), [{"a": 1.0}])


def test_target_history_guard_refuses_missing_history_column() -> None:
    descriptor = _descriptor(derivedFromTarget=["lag_1"])
    with pytest.raises(PredictError, match="lag_1"):
        assert_history_satisfies_target_derivation(descriptor, [{"a": 1.0}])


def test_target_history_guard_passes_when_history_present() -> None:
    descriptor = _descriptor(derivedFromTarget=["lag_1"])
    assert_history_satisfies_target_derivation(
        descriptor, [{"a": 1.0, "lag_1": 3.0}]
    )


# ── MODEL-SERVE-002-V03: the fabricated target-derived fixture ────────────
#
# No real feature_spec.json in this system has a non-empty
# derived_from_target (0 of 21, per MODEL-SERVE-000-T04's live census), so
# this class of model is exercised here by construction. The recipe below is
# the shape build_feature_spec would emit for "lag 3 of the target, then a
# 12-wide rolling mean OF that lag" — the compounding case, whose depth
# (12 + 3 = 15) a non-compounding implementation would under-report as 12.

_TARGET = "S204FBP.lab"

_TARGET_DERIVED_RECIPE = [
    {"kind": "lag", "tag": _TARGET, "k": 3},
    {"kind": "rolling", "tag": f"{_TARGET}__lag3", "window": 12, "agg": "mean"},
]


def _target_derived_descriptor(**overrides) -> dict:
    lag_col = f"{_TARGET}__lag3"
    roll_col = f"{lag_col}__roll12_mean"
    base = {
        "featureColumns": ["a", lag_col, roll_col],
        "scalers": {},
        "scalingParams": {
            "a": {"min": 0.0, "max": 10.0},
            lag_col: {"min": 0.0, "max": 10.0},
            roll_col: {"min": 0.0, "max": 10.0},
        },
        "derivedFromTarget": [lag_col, roll_col],
        "features": _TARGET_DERIVED_RECIPE,
    }
    base.update(overrides)
    return base


def test_v03_required_history_rows_compounds_through_the_recipe() -> None:
    """15, not 12: the rolling(12) sits on top of a lag(3), so the recipe
    reaches back both. Same compounding prepare_holdout_for_run refuses on."""
    assert required_history_rows(_target_derived_descriptor()) == 15


def test_v03_history_less_request_is_refused_naming_columns_and_depth() -> None:
    descriptor = _target_derived_descriptor()
    with pytest.raises(PredictError) as exc:
        assert_history_satisfies_target_derivation(descriptor, [{"a": 1.0}])
    message = str(exc.value)
    # Names WHICH history is missing...
    assert f"{_TARGET}__lag3" in message
    # ...and HOW FAR BACK the caller must go to produce it, which is the
    # half a bare presence check leaves the caller unable to act on.
    assert "15 consecutive prior observation(s)" in message


def test_v03_request_carrying_the_full_history_columns_is_accepted() -> None:
    descriptor = _target_derived_descriptor()
    lag_col = f"{_TARGET}__lag3"
    roll_col = f"{lag_col}__roll12_mean"
    assert_history_satisfies_target_derivation(
        descriptor, [{"a": 1.0, lag_col: 2.0, roll_col: 3.0}]
    )


def test_v03_partial_history_across_rows_is_still_refused() -> None:
    """One row carrying the column does not excuse another that omits it —
    a batch is refused if ANY row is short, since the missing row would
    otherwise predict from an absent lag."""
    descriptor = _target_derived_descriptor()
    lag_col = f"{_TARGET}__lag3"
    roll_col = f"{lag_col}__roll12_mean"
    with pytest.raises(PredictError, match=lag_col):
        assert_history_satisfies_target_derivation(
            descriptor,
            [
                {"a": 1.0, lag_col: 2.0, roll_col: 3.0},
                {"a": 1.0, roll_col: 3.0},
            ],
        )


def test_required_history_rows_is_zero_when_no_recipe_is_carried() -> None:
    """A descriptor with no `features` (a spec read before the field was
    passed through) reports unknown depth as 0 rather than fabricating a
    number, and the refusal then simply omits the depth sentence."""
    descriptor = _target_derived_descriptor(features=[])
    assert required_history_rows(descriptor) == 0
    with pytest.raises(PredictError) as exc:
        assert_history_satisfies_target_derivation(descriptor, [{"a": 1.0}])
    assert "consecutive prior observation" not in str(exc.value)


def test_required_history_rows_survives_an_unreadable_recipe() -> None:
    """An unparseable recipe must not turn a satisfiable request into a
    500 — depth is advisory context on a refusal, not itself a gate."""
    descriptor = _target_derived_descriptor(
        features=[{"kind": "lag", "tag": "x"}]  # no `k`
    )
    assert required_history_rows(descriptor) == 0
