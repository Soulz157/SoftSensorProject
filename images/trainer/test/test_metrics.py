"""regression_metrics' `y_true_distinct` — the only signal downstream has
that an r2 figure was computed over a constant target.

sklearn's `r2_score` returns a plain 0.0 for a constant `y_true` (its
`force_finite` default replaces the NaN), so the r2 value itself cannot tell a
flat lab target from a genuinely zero-skill model. Reported live 2026-10-12:
`s611water.lab` sat at 1.2764 for all of Dec 2022 and its holdout r2 read as a
believable number."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from metrics import regression_metrics


def test_constant_target_reports_one_distinct_value_and_r2_stays_a_float() -> None:
    y_true = pd.Series([1.2764] * 6)
    y_pred = np.array([1.1, 1.2, 1.3, 1.25, 1.27, 1.3])

    m = regression_metrics(y_true, y_pred)

    assert m["y_true_distinct"] == 1
    # Still a number — the log line, CV aggregation and sorting all read it.
    assert isinstance(m["r2"], float) and math.isfinite(m["r2"])
    assert m["mae"] > 0 and m["rmse"] > 0


def test_varied_target_reports_its_real_distinct_count() -> None:
    m = regression_metrics(
        pd.Series([1.0, 2.0, 2.0, 3.0]), np.array([1.1, 1.9, 2.1, 2.9])
    )
    assert m["y_true_distinct"] == 3


def test_prefix_applies_to_the_distinct_key_too() -> None:
    m = regression_metrics(np.array([5.0, 5.0]), np.array([4.0, 6.0]), prefix="train_")
    assert m["train_y_true_distinct"] == 1
    assert "y_true_distinct" not in m

