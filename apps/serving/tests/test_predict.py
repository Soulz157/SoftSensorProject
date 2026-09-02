"""MODEL-SERVE-002-T04/T06. Column-naming, coverage-guard refusal, and the
target-derived history guard — all against a trivial fitted model so the
result value itself is not the point.
"""

from __future__ import annotations

import pytest

from services.predict import (
    PredictError,
    assert_history_satisfies_target_derivation,
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
