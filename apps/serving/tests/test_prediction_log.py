"""MODEL-SERVE-001-T13. `bucket_histograms` — the write-time PSI
orchestration: per-tag reference-presence gating, missing-value handling,
population selection. The actual bucketing MATH (boundary conditions,
categorical nearest-match, `refCounts`) is `softsensor_scaling.psi`'s own
concern, covered directly in `packages/py-scaling/tests/test_psi.py` — this
file does not re-test it, only that `bucket_histograms` calls into it
correctly.
"""

from __future__ import annotations

from services.prediction_log import bucket_histograms

CONTINUOUS_EDGES = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0]  # 5 bins


def test_bucket_histograms_skips_a_tag_with_no_frozen_reference() -> None:
    """`NOREF` carries no entry in any of the three per-tag maps — absent
    from the result entirely, never a fabricated all-zero histogram."""
    rows = [{"TI": 5.0, "NOREF": 1.0}]
    result = bucket_histograms(
        rows, ["TI", "NOREF"],
        {"TI": CONTINUOUS_EDGES}, {"TI": 5}, {"TI": "continuous"},
    )
    assert result is not None
    assert set(result) == {"TI"}


def test_bucket_histograms_returns_none_when_nothing_was_bucketable() -> None:
    """Distinguishes "computed, no tag had a reference" from a
    present-but-empty `{}` — the caller (`log_prediction`) writes this
    straight into the nullable `featureHistograms` column."""
    rows = [{"TI": 5.0}]
    assert bucket_histograms(rows, ["TI"], None, None, None) is None


def test_bucket_histograms_skips_missing_values_without_a_hole_in_bin_zero() -> None:
    """A `None` feature value is skipped, never coerced into a real bin —
    `_validate_rows` normally prevents this on `/predict`, but the
    orchestration itself must not assume that upstream guarantee."""
    rows = [{"TI": 5.0}, {"TI": None}, {"TI": 15.0}]
    result = bucket_histograms(
        rows, ["TI"], {"TI": CONTINUOUS_EDGES}, {"TI": 5}, {"TI": "continuous"},
    )
    assert result == {"TI": {"counts": [1, 1, 0, 0, 0], "below": 0, "above": 0}}


def test_bucket_histograms_bins_the_full_row_population_not_a_cap() -> None:
    """Same population `_column_aggregate` covers for `featureStats` — no
    `SERVING_LOG_MAX_ROWS`-style truncation inside this function itself
    (that cap only ever applied to the separate per-row detail log)."""
    rows = [{"TI": 5.0} for _ in range(500)]
    result = bucket_histograms(
        rows, ["TI"], {"TI": CONTINUOUS_EDGES}, {"TI": 5}, {"TI": "continuous"},
    )
    assert result == {"TI": {"counts": [500, 0, 0, 0, 0], "below": 0, "above": 0}}
