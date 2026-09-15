"""MODEL-SERVE-001-T13. `bucket_value`/`bucket_histogram`/`quantile_edges` —
the shared PSI bucketing primitives training (`apps/python`) and serving
(`apps/serving`) both import, so a value is binned the identical way at fit
time and at inference time.

`refCounts` gets its own dedicated coverage here (not left implicit in
`bucket_value`'s boundary tests): the whole reason this module exists as a
correction to an earlier draft is that a categorical split's reference
proportions are NOT uniform (a valve closed 90% of the time has a 90/10
split, not 50/50) — the case a naive "assume equal-frequency" implementation
would get silently wrong.
"""

from __future__ import annotations

import numpy as np

from softsensor_scaling import (
    MIN_PSI_BINS,
    bucket_histogram,
    bucket_value,
    quantile_edges,
)

CONTINUOUS_EDGES = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0]  # 5 bins


# ── bucket_value ─────────────────────────────────────────────────────────


def test_bucket_value_below_and_above_the_trained_range() -> None:
    assert bucket_value(-5.0, CONTINUOUS_EDGES, "continuous") == (None, "below")
    assert bucket_value(55.0, CONTINUOUS_EDGES, "continuous") == (None, "above")


def test_bucket_value_exact_left_edge_lands_in_first_bin() -> None:
    assert bucket_value(0.0, CONTINUOUS_EDGES, "continuous") == (0, None)


def test_bucket_value_exact_right_edge_lands_in_last_bin_closed() -> None:
    """The last bin is closed on the right (numpy.histogram's own
    convention) — the trained maximum must not read as `"above"`."""
    assert bucket_value(50.0, CONTINUOUS_EDGES, "continuous") == (4, None)


def test_bucket_value_interior_boundary_is_half_open_left() -> None:
    """A value exactly on an interior edge belongs to the bin that STARTS
    there, not the one that ends there — `[edges[i], edges[i+1])`."""
    assert bucket_value(20.0, CONTINUOUS_EDGES, "continuous") == (2, None)


def test_bucket_value_categorical_matches_nearest_trained_value() -> None:
    """A state tag reading 0.02/0.9 instead of exactly 0.0/1.0 (real
    telemetry noise) still counts, against its nearest trained value."""
    edges = [0.0, 1.0]
    assert bucket_value(0.02, edges, "categorical") == (0, None)
    assert bucket_value(0.9, edges, "categorical") == (1, None)


def test_bucket_value_categorical_never_reports_overflow() -> None:
    """Some trained value is always nearest — no "out of range" concept."""
    edges = [0.0, 1.0]
    assert bucket_value(999.0, edges, "categorical") == (1, None)
    assert bucket_value(-999.0, edges, "categorical") == (0, None)


# ── bucket_histogram ─────────────────────────────────────────────────────


def test_bucket_histogram_counts_below_above_and_interior() -> None:
    values = np.array([5.0, 15.0, -100.0, 999.0])
    result = bucket_histogram(values, CONTINUOUS_EDGES, "continuous")
    assert result == {"counts": [1, 1, 0, 0, 0], "below": 1, "above": 1}


def test_bucket_histogram_empty_array_is_all_zero() -> None:
    result = bucket_histogram(np.array([]), CONTINUOUS_EDGES, "continuous")
    assert result == {"counts": [0, 0, 0, 0, 0], "below": 0, "above": 0}


# ── quantile_edges: shape ────────────────────────────────────────────────


def test_quantile_edges_none_for_empty_input() -> None:
    assert quantile_edges(np.array([])) is None


def test_quantile_edges_continuous_gets_bin_count_plus_one_edges() -> None:
    values = np.array([float(i) for i in range(100)])  # 100 distinct values
    result = quantile_edges(values, bin_count=10)
    assert result["binMode"] == "continuous"
    assert result["binCount"] == 10
    assert len(result["edges"]) == 11
    assert result["edges"] == sorted(result["edges"])


def test_quantile_edges_digital_tag_falls_back_to_categorical() -> None:
    """T13's own named example: a valve open/closed tag has only 2 distinct
    Good values — not a continuous-binning candidate."""
    values = np.array([0.0] * 40 + [1.0] * 60)
    result = quantile_edges(values)
    assert result["binMode"] == "categorical"
    assert result["binCount"] == 2
    assert result["edges"] == [0.0, 1.0]


def test_quantile_edges_single_distinct_value_is_categorical() -> None:
    result = quantile_edges(np.array([5.0] * 10))
    assert result["binMode"] == "categorical"
    assert result["binCount"] == 1
    assert result["edges"] == [5.0]


# ── quantile_edges: refCounts is MEASURED, never assumed uniform ────────


def test_quantile_edges_continuous_ref_counts_sum_to_population() -> None:
    """Every train value lands in exactly one bin — no value is lost or
    double-counted by re-bucketing the population against its own edges."""
    values = np.array([float(i) for i in range(97)])
    result = quantile_edges(values, bin_count=10)
    assert sum(result["refCounts"]) == 97
    assert len(result["refCounts"]) == result["binCount"]


def test_quantile_edges_continuous_ref_counts_are_never_zero() -> None:
    """The zero-reference-count disqualifier: every bin quantile binning
    actually returns must hold at least one training point (the categorical
    fallback exists specifically so this function never returns a zero)."""
    rng = np.random.default_rng(0)
    values = rng.uniform(0, 100, 500)
    result = quantile_edges(values, bin_count=10)
    assert all(c > 0 for c in result["refCounts"])


def test_quantile_edges_categorical_ref_counts_are_the_real_skewed_split() -> None:
    """THE case this module exists to get right: a valve closed 90% of the
    time has a 90/10 reference split, not the 50/50 a uniform-per-bin
    assumption would silently produce. `edges` is sorted ([0.0, 1.0]), so
    `refCounts` must land in that same order: [closed_count, open_count]."""
    values = np.array([0.0] * 90 + [1.0] * 10)
    result = quantile_edges(values)
    assert result["binMode"] == "categorical"
    assert result["edges"] == [0.0, 1.0]
    assert result["refCounts"] == [90, 10]
    assert sum(result["refCounts"]) == 100


def test_quantile_edges_categorical_ref_counts_are_never_zero_by_construction() -> None:
    """Every categorical bin is built directly from a distinct value that
    was actually observed — `np.unique` cannot produce a value with a real
    zero count. Forced into categorical mode via `bin_count=1` (below
    `MIN_PSI_BINS`), since 3 distinct values alone would take the
    continuous branch (covered separately below)."""
    values = np.array([1.0, 2.0, 2.0, 3.0, 3.0, 3.0])
    result = quantile_edges(values, bin_count=1)
    assert result["binMode"] == "categorical"
    assert result["edges"] == [1.0, 2.0, 3.0]
    assert result["refCounts"] == [1, 2, 3]
    assert all(c > 0 for c in result["refCounts"])


def test_quantile_edges_continuous_ref_counts_reflect_real_skew_not_uniform() -> None:
    """Same skewed population, but with enough distinct values relative to
    `bin_count` to take the CONTINUOUS branch — `refCounts` must still be
    the real per-bin population, never an assumed uniform split just
    because continuous bins are usually equal-frequency. Requesting 3 bins
    over [1,2,2,3,3,3] dedupes to 2 real edges ([1.0, 2.0, 3.0]) — measured
    directly, not hand-derived, since the exact dedup/bucketing interaction
    is what this test exists to pin."""
    values = np.array([1.0, 2.0, 2.0, 3.0, 3.0, 3.0])
    result = quantile_edges(values, bin_count=3)
    assert result["binMode"] == "continuous"
    assert result["binCount"] == 2
    assert result["edges"] == [1.0, 2.0, 3.0]
    # bin0 = [1.0, 2.0): only the single 1.0. bin1 = [2.0, 3.0] (closed
    # right): both 2.0's and all three 3.0's — 1/5, not a uniform 3/3.
    assert result["refCounts"] == [1, 5]
    assert sum(result["refCounts"]) == 6


def test_quantile_edges_min_psi_bins_is_two() -> None:
    assert MIN_PSI_BINS == 2
