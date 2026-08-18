"""DS-LAKE-005B-D-T05a. Standalone unit tests, no frame plumbing required
for most cases — same discipline `test_downsample.py` uses for
`lttb_indices`: prove the algorithm's own claims before any endpoint calls
it (T05b, not yet built)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD, status_column
from services.correlation_selector import (
    NEAR_CONSTANT_SCORE_THRESHOLD,
    score_column,
    select_correlation_columns,
)


# ── score_column: bare-array unit tests ─────────────────────────────────


def test_normal_tag_uses_iqr_median():
    # Uniform 1..101, median=51, IQR is well away from 0 -> stable ratio.
    good = np.array([float(i) for i in range(1, 102)])
    result = score_column(good)
    assert result is not None
    assert result.metric == "iqr_median"
    assert result.near_constant is False
    assert result.score > 0


def test_near_zero_median_falls_back_to_cv():
    # Symmetric around 0 but median lands exactly at 0 by construction.
    good = np.array([-10.0, -5.0, 0.0, 5.0, 10.0])
    result = score_column(good)
    assert result is not None
    assert result.metric == "cv"


def test_doubly_degenerate_median_and_mean_near_zero_is_near_constant():
    # Symmetric noise around exactly 0 -- both center estimates vanish.
    good = np.array([-1.0, -0.5, 0.0, 0.5, 1.0])
    result = score_column(good)
    assert result is not None
    assert result.near_constant is True
    assert result.score == 0.0


def test_near_constant_tag_is_flagged():
    # Values vary by a tiny fraction of the median -- should be excluded.
    good = np.full(50, 100.0)
    good[0] = 100.0000001
    result = score_column(good)
    assert result is not None
    assert result.near_constant is True


def test_flat_tag_is_near_constant():
    good = np.full(20, 42.0)
    result = score_column(good)
    assert result is not None
    assert result.near_constant is True
    assert result.score == 0.0


def test_fewer_than_two_good_values_returns_none():
    assert score_column(np.array([])) is None
    assert score_column(np.array([5.0])) is None


def test_score_is_never_negative():
    rng = np.random.default_rng(7)
    for _ in range(20):
        good = rng.normal(rng.uniform(-100, 100), rng.uniform(0.01, 50), 30)
        result = score_column(good)
        assert result is not None
        assert result.score >= 0


# ── select_correlation_columns: frame-level integration ─────────────────


def _frame(columns: dict[str, list[float]]) -> pd.DataFrame:
    n = len(next(iter(columns.values())))
    data: dict[str, object] = {"timestamp": pd.date_range("2026-06-22", periods=n, freq="min")}
    for tag, values in columns.items():
        data[tag] = values
        data[status_column(tag)] = [STATUS_GOOD] * n
    return pd.DataFrame(data)


def test_near_constant_tags_never_enter_top_k():
    frame = _frame(
        {
            "VARIABLE": [float(i) for i in range(100)],
            "FLAT": [42.0] * 100,
        }
    )
    ranked, scores = select_correlation_columns(frame, ["VARIABLE", "FLAT"], top_k=10)
    assert "FLAT" not in ranked
    assert "VARIABLE" in ranked
    assert scores["FLAT"].near_constant is True


def test_ranking_orders_by_score_descending():
    rng = np.random.default_rng(1)
    frame = _frame(
        {
            "LOW_VAR": (100 + rng.normal(0, 1, 200)).tolist(),
            "HIGH_VAR": (100 + rng.normal(0, 40, 200)).tolist(),
            "MID_VAR": (100 + rng.normal(0, 10, 200)).tolist(),
        }
    )
    ranked, _ = select_correlation_columns(
        frame, ["LOW_VAR", "HIGH_VAR", "MID_VAR"], top_k=3
    )
    assert ranked == ["HIGH_VAR", "MID_VAR", "LOW_VAR"]


def test_top_k_caps_the_output():
    tags = [f"T{i}" for i in range(10)]
    frame = _frame({t: [float(i), float(i) + 10, float(i) + 20] for i, t in enumerate(tags)})
    ranked, _ = select_correlation_columns(frame, tags, top_k=2)
    assert len(ranked) <= 2


def test_tags_with_insufficient_good_values_are_excluded_not_crashed():
    frame = _frame({"SPARSE": [1.0, 2.0, 3.0]})
    # Flip all but one cell Bad -- fewer than 2 Good values.
    frame.loc[1:, status_column("SPARSE")] = STATUS_BAD
    ranked, scores = select_correlation_columns(frame, ["SPARSE"], top_k=5)
    assert ranked == []
    assert "SPARSE" not in scores  # score_column returned None, never scored


def test_unknown_column_raises_a_caller_fixable_error():
    frame = _frame({"REAL": [1.0, 2.0, 3.0]})
    with pytest.raises(KeyError):
        select_correlation_columns(frame, ["REAL", "NOT-A-TAG"], top_k=5)


def test_threshold_constant_is_a_real_positive_bound():
    # Guards against an accidental 0/negative threshold silently disabling
    # the near-constant filter entirely.
    assert NEAR_CONSTANT_SCORE_THRESHOLD > 0
