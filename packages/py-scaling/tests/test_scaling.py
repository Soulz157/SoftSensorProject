"""Package self-tests. MODEL-SERVE-002 Stage 1a's own non-negotiable rule:
resolve each tag's method as `scalers.get(tag, DEFAULT_SCALER)`, never by
branching on whether `scaling` is non-empty — an empty `scaling` list next
to a fully populated `scalingParams` is exactly what every real
`feature_spec.json` in this system looks like (MODEL-SERVE-000-T03's
empty-`scaling`-array finding, live-verified again in this ledger for run
`cd2db914-3bb4-4abb-a305-9f3ae19eb50d`: `scaling: []`, `scalingParams` with
22 entries).
"""

from __future__ import annotations

import pandas as pd
import pytest

from softsensor_scaling import (
    DEFAULT_SCALER,
    FeatureError,
    STATUS_GOOD,
    assert_scaling_coverage,
    status_column,
    to_model_ready,
)


def _frame(values: list[float]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-01-01", periods=len(values), freq="5min"),
            "TAG1": values,
        }
    )


def test_empty_scaling_dict_still_scales_every_tag_at_the_default():
    """The trap, reproduced directly: an EMPTY `scalers` mapping (the
    `scaling: []` shape every real feature_spec.json has) must still scale
    every tag at DEFAULT_SCALER — never treated as "nothing to scale".
    """
    df = _frame([0.0, 5.0, 10.0])
    out, params = to_model_ready(df, ["TAG1"], scalers={})
    assert DEFAULT_SCALER == "minmax"
    assert out["TAG1"].tolist() == [0.0, 0.5, 1.0]
    assert params == {"TAG1": {"min": 0.0, "max": 10.0}}
    assert out[status_column("TAG1")].tolist() == [STATUS_GOOD] * 3


def test_fitted_params_are_applied_not_refit():
    """Predict-time path: supplied `fitted_params` are used verbatim, never
    re-derived from this frame's own values — the same guarantee holdout
    replay and MODEL-SERVE-002's serving loader both depend on.
    """
    df = _frame([100.0])  # would fit to (100, 100) if re-fit — span 0 trap
    out, params = to_model_ready(
        df, ["TAG1"], scalers={}, fitted_params={"TAG1": {"min": 0.0, "max": 200.0}}
    )
    assert out["TAG1"].tolist() == [0.5]
    assert params == {"TAG1": {"min": 0.0, "max": 200.0}}


def test_assert_scaling_coverage_refuses_an_unrecorded_default_scaled_tag():
    """A tag absent from `scalers` (so it resolves to DEFAULT_SCALER) but
    absent from `scaling_params` too must be refused — checking `scalers`
    or the (near-always-empty) `scaling` list for emptiness would miss
    this exactly the way the empty-scaling-array trap describes.
    """
    with pytest.raises(ValueError, match="TAG1"):
        assert_scaling_coverage(["TAG1"], scalers={}, scaling_params={})


def test_assert_scaling_coverage_passes_when_covered():
    assert_scaling_coverage(
        ["TAG1"], scalers={}, scaling_params={"TAG1": {"min": 0.0, "max": 1.0}}
    )


def test_assert_scaling_coverage_exempts_none_scaled_tags():
    assert_scaling_coverage(["TAG1"], scalers={"TAG1": "none"}, scaling_params={})


def test_unknown_scaler_raises_feature_error():
    df = _frame([1.0, 2.0])
    with pytest.raises(FeatureError, match="bogus"):
        to_model_ready(df, ["TAG1"], scalers={"TAG1": "bogus"})
