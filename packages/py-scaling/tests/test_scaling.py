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

import numpy as np
import pandas as pd
import pytest

from softsensor_scaling import (
    DEFAULT_SCALER,
    FeatureError,
    NotInvertibleError,
    STATUS_GOOD,
    _scale_column,
    assert_scaling_coverage,
    infer_scaler_method,
    inverse_scale_column,
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


# ── DS-LAKE-028-T05: the inverse ───────────────────────────────────────────


def test_every_scaler_round_trips_to_within_the_quantization_bound():
    """One implementation of the inverse, in the package that owns the
    forward transform — so a serving-side caller cannot grow a second one
    that disagrees with this.

    THE BOUND IS ASSERTED, NOT ASSUMED AWAY. `_scale_column` rounds every
    value it writes to 3 decimals, so the inverse is exact only when the
    slope is 1 — `standard` here misses by 2e-4 on a span of 2, which is
    the +/-0.001 * span the docstring states. A default `np.allclose` would
    FAIL on that (rtol 1e-5), and loosening it to "close enough" would hide
    the one property every caller has to disclose. So this asserts the
    recovery lands inside the stated bound and NOT that it is exact.
    """
    values = np.array([1.0, 2.0, 3.0])
    span = float(values.max() - values.min())
    for method in ("minmax", "standard", "robust"):
        scaled, params = _scale_column(values, method)
        recovered = inverse_scale_column(scaled, params)
        assert np.all(np.abs(recovered - values) <= 0.001 * span), method


def test_degenerate_minmax_and_standard_invert_but_robust_refuses():
    """The three all wrote 0.0 for every row, and they are NOT the same case.
    minmax/span==0 and standard/std==0 recorded the centre every row actually
    equalled, so returning it is correct. robust/iqr==0 recorded a median it
    did not derive from a spread, and nothing recoverable about the rows —
    so it raises instead of returning a plausible number."""
    assert inverse_scale_column(np.array([0.0, 0.0]), {"min": 7.0, "max": 7.0}).tolist() == [7.0, 7.0]
    assert inverse_scale_column(np.array([0.0]), {"mean": 3.0, "std": 0.0}).tolist() == [3.0]
    with pytest.raises(NotInvertibleError):
        inverse_scale_column(np.array([0.0]), {"median": 5.0, "iqr": 0.0})


def test_method_is_inferred_from_the_params_own_key_shape():
    """`scalingParams` records numbers, never the method's name — the three
    shapes are disjoint and that is what makes it readable at all."""
    assert infer_scaler_method({"min": 0.0, "max": 1.0}) == "minmax"
    assert infer_scaler_method({"mean": 0.0, "std": 1.0}) == "standard"
    assert infer_scaler_method({"median": 0.0, "iqr": 1.0}) == "robust"
    with pytest.raises(FeatureError):
        infer_scaler_method({"lo": 0.0})
