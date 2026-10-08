"""DS-LAKE-005B-A-T06: LTTB core, tested standalone before any endpoint exists
to call it (advisor guidance during this task: prove the algorithm's own
claims — the "at or under max_points" bound and "local extrema survive" —
before building request/response plumbing around a design that might not
hold them).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from services.downsample import (
    grid_bin_indices,
    lttb_indices,
    systematic_sample,
    time_bucket_edges,
)

# ── V05: six months at 1-minute interval, one tag ──────────────────────────


def six_month_series(spike_at: int | None = None, spike_value: float = 500.0):
    """A smooth sine wave over six months at 1-minute resolution, matching
    V05's own scenario, with an optional single injected spike."""
    periods = 6 * 30 * 24 * 60  # ~259,200 points
    timestamps = pd.date_range("2025-01-01", periods=periods, freq="1min")
    values = 20.0 + 5.0 * np.sin(np.linspace(0, 200 * np.pi, periods))
    if spike_at is not None:
        values[spike_at] = spike_value
    return timestamps.to_numpy(), values


def test_returns_at_or_under_max_points_not_over():
    timestamps, values = six_month_series()
    max_points = 2_000

    result = lttb_indices(timestamps, values, max_points)

    # The hard bound V05 names: max_points is a ceiling, inclusive of the
    # two endpoints LTTB always keeps — not max_points buckets PLUS two
    # endpoints, which would silently return max_points + 2.
    assert len(result.indices) <= max_points
    assert result.downsampled is True


def test_ratio_matches_input_and_output_lengths():
    timestamps, values = six_month_series()
    max_points = 2_000

    result = lttb_indices(timestamps, values, max_points)

    expected_ratio = round(len(timestamps) / len(result.indices), 4)
    assert result.ratio == expected_ratio


def test_indices_are_ascending_and_within_bounds():
    timestamps, values = six_month_series()
    result = lttb_indices(timestamps, values, 500)

    assert list(result.indices) == sorted(result.indices.tolist())
    assert result.indices[0] == 0
    assert result.indices[-1] == len(timestamps) - 1
    assert result.indices.min() >= 0
    assert result.indices.max() < len(timestamps)


def test_a_single_injected_spike_survives_the_reduction():
    """V05's actual claim: local extrema of the source series survive.

    HONEST SCOPE NOTE: a spike this far above a smooth sine floor (500 vs a
    ~[15, 25] baseline) has by far the largest triangle area in its bucket,
    so plain area-based selection would ALSO keep it — this test does not,
    by itself, prove the global-extrema PROTECTION added on top of area
    selection is load-bearing. It proves the guard does not break the easy
    case. Protection matters for a harder case (two comparably-extreme
    points sharing one bucket, or an extremum with small local deviation
    despite a large global value) that is not constructed here.
    """
    periods = 6 * 30 * 24 * 60
    spike_at = periods // 2
    timestamps, values = six_month_series(spike_at=spike_at, spike_value=500.0)

    result = lttb_indices(timestamps, values, 2_000)

    assert spike_at in result.indices


def test_two_comparably_extreme_points_in_one_bucket_the_guard_is_what_saves_the_true_extreme():
    """V05's own scope note (feature_list.preprocessing.json): the spike test
    above is not discriminating — a 500-vs-~20 deviation wins the area
    contest on its own, guard or no guard. This constructs the case the note
    asks for: two points sharing ONE bucket where the TRUE global extreme has
    a SMALL triangle area (so pure area-based selection would drop it) and a
    second, comparably-elevated-but-not-global-max point has a LARGER area
    (so it wins the area contest instead).

    5 points, max_points=3 -> one interior bucket holds indices 1-3:
      idx0 (t=0,  v=0)   — always-kept start anchor
      idx1 (t=10, v=100) — the TRUE global max, placed close in time to the
                           start anchor so its triangle area is small
      idx2 (t=90, v=50)  — comparably elevated (well above the 5.0/0.0
                           floor at idx3/idx4) but NOT the global max — far
                           from the anchor line, so it wins area-based
                           selection on its own
      idx3 (t=95, v=5)
      idx4 (t=100,v=0)   — always-kept end anchor

    Sanity check FIRST (same convention as the Bad-cell-hole test below):
    with idx1 excluded from protection eligibility, pure area-based
    selection must pick idx2, not idx1 — proving the scenario really is
    discriminating before trusting the protected assertion.
    """
    timestamps = np.array([0, 10, 90, 95, 100], dtype="datetime64[s]")
    values = np.array([0.0, 100.0, 50.0, 5.0, 0.0])
    global_max_idx = 1  # value 100 — the true global max

    valid = np.ones(len(values), dtype=bool)
    valid[global_max_idx] = False
    unprotected = lttb_indices(timestamps, values, max_points=3, valid=valid)
    assert global_max_idx not in unprotected.indices
    assert 2 in unprotected.indices  # area-based pick, not the true extreme

    protected = lttb_indices(timestamps, values, max_points=3)
    assert global_max_idx in protected.indices


def test_a_single_injected_trough_survives_the_reduction():
    periods = 6 * 30 * 24 * 60
    trough_at = periods // 3
    timestamps, values = six_month_series()
    values[trough_at] = -500.0

    result = lttb_indices(timestamps, values, 2_000)

    assert trough_at in result.indices


def test_no_downsampling_when_source_already_fits():
    timestamps, values = six_month_series()
    small_t, small_v = timestamps[:100], values[:100]

    result = lttb_indices(small_t, small_v, 2_000)

    assert result.downsampled is False
    assert result.ratio == 1.0
    assert len(result.indices) == 100
    assert list(result.indices) == list(range(100))


def test_max_points_below_three_is_treated_as_no_reduction():
    """A degenerate request (max_points=1 or 2) cannot form a triangle at
    all; falling back to "no downsampling" is safer than dividing by a
    bucket count of zero or negative."""
    timestamps, values = six_month_series()

    result = lttb_indices(timestamps, values, 2)

    assert result.downsampled is False
    assert len(result.indices) == len(timestamps)


def test_valid_mask_stops_a_bad_cell_hole_from_being_protected_as_the_trough():
    """On a real artifact, a Bad cell holds `0.0` (frame_service.MISSING_VALUE),
    not NaN. The hole must be numerically BELOW the real trough for this to
    be discriminating — an earlier version of this test set the trough to
    -500 (below the 0.0 hole), so unmasked argmin already found the real
    trough and the mask was never exercised. Here the sine wave floors at
    15.0, the "trough" is 8.0 (still the true minimum of any Good cell), and
    the hole is 0.0 — lower than both, so unmasked argmin picks the hole and
    only the masked version can find the real trough.
    """
    timestamps, values = six_month_series()
    trough_at = 55_000
    values[trough_at] = 8.0  # the REAL minimum among Good cells
    hole_at = 10
    values[hole_at] = 0.0  # a Bad-cell hole, numerically LOWER than the trough

    valid = np.ones(len(values), dtype=bool)
    valid[hole_at] = False  # marks the hole as excluded, not the trough

    # Sanity check FIRST: prove the scenario is actually discriminating.
    # Without the mask, np.argmin finds the hole (0.0), not the trough
    # (8.0) — if this failed, the masked assertion below would prove
    # nothing.
    unmasked = lttb_indices(timestamps, values, 2_000)
    assert hole_at in unmasked.indices

    masked = lttb_indices(timestamps, values, 2_000, valid=valid)
    assert trough_at in masked.indices


def test_all_invalid_disables_protection_without_raising():
    timestamps, values = six_month_series()
    valid = np.zeros(len(values), dtype=bool)

    result = lttb_indices(timestamps, values, 2_000, valid=valid)

    assert len(result.indices) <= 2_000  # still ran; just no extrema guarantee


# ── V06: shared bucket basis makes an identity recipe a no-op diff ─────────


def test_identical_series_downsample_to_identical_indices_given_shared_edges():
    """The core guarantee T06 exists for: if before and after are byte-
    identical (an identity cleaning recipe), downsampling both against the
    SAME time-domain edges must select the identical indices — a diff can
    only come from the transform, never from the sampler.
    """
    timestamps, values = six_month_series(spike_at=12_345, spike_value=500.0)
    max_points = 1_500

    edges_source = timestamps  # edges derived once, from the shared window
    shared_edges = np.array(
        [np.datetime64(e) for e in time_bucket_edges(edges_source, max_points)]
    )

    before = lttb_indices(timestamps, values, max_points, edges=shared_edges)
    after = lttb_indices(timestamps.copy(), values.copy(), max_points, edges=shared_edges)

    assert list(before.indices) == list(after.indices)
    assert before.bucket_edges == after.bucket_edges


def test_row_removing_op_changes_count_but_edges_stay_shared():
    """A row-removing op (drop_missing, remove_duplicates, remove_outlier)
    shrinks the AFTER frame's row count without moving the time window.
    Time-domain edges computed from the BEFORE window must still apply to
    the shorter AFTER series — this is what makes edges invariant to count,
    unlike textbook index-based LTTB.
    """
    timestamps, values = six_month_series()
    max_points = 800

    shared_edges = np.array(
        [np.datetime64(e) for e in time_bucket_edges(timestamps, max_points)]
    )

    # Simulate a row-removing op: drop every 10th row, but keep the window's
    # first/last timestamp intact (an op does not change the overall span).
    keep = np.ones(len(timestamps), dtype=bool)
    keep[10:-10:10] = False
    after_t, after_v = timestamps[keep], values[keep]

    before = lttb_indices(timestamps, values, max_points, edges=shared_edges)
    after = lttb_indices(after_t, after_v, max_points, edges=shared_edges)

    assert len(timestamps) != len(after_t)  # the row-removal actually happened
    # Both still bucket against the identical edges, not edges re-derived
    # from each frame's own (now-different) length.
    assert before.bucket_edges == after.bucket_edges
    assert len(before.indices) <= max_points
    assert len(after.indices) <= max_points


# ── DS-LAKE-005B-D-T04: grid_bin_indices (2D scatter decimation) ───────────
#
# Standalone, before the request/response plumbing around it, same
# discipline this file's own header describes for lttb_indices. Moved here
# from an ad-hoc shell check run during development — committed so the
# claim in DS-LAKE-005B-D-T04's own `result` is actually verifiable, not
# just asserted.


def test_grid_bounded_no_dupes_ascending():
    rng = np.random.default_rng(42)
    x = rng.uniform(0, 100, 5_000)
    y = rng.uniform(0, 100, 5_000)

    result = grid_bin_indices(x, y, 200)

    assert result.downsampled is True
    assert len(result.indices) <= 200
    assert len(set(result.indices.tolist())) == len(result.indices)
    assert (np.diff(result.indices) > 0).all()


def test_grid_below_cap_is_identity():
    rng = np.random.default_rng(42)
    x = rng.uniform(0, 100, 50)
    y = rng.uniform(0, 100, 50)

    result = grid_bin_indices(x, y, 200)

    assert result.downsampled is False
    assert len(result.indices) == 50


def test_grid_valid_mask_excludes_points():
    rng = np.random.default_rng(42)
    x = rng.uniform(0, 100, 5_000)
    y = rng.uniform(0, 100, 5_000)
    valid = np.zeros(5_000, dtype=bool)
    valid[::2] = True  # only even indices eligible

    result = grid_bin_indices(x, y, 200, valid=valid)

    assert all(i % 2 == 0 for i in result.indices)


def test_grid_single_occupied_cell_for_a_degenerate_point():
    xs = np.full(500, 5.0)
    ys = np.full(500, 5.0)

    result = grid_bin_indices(xs, ys, 100)

    assert len(result.indices) == 1


# ── MODEL-FLOW-014-T02: systematic_sample replaces the old frame.head(n)
# cut in boxplot/histogram/scatter/correlation. V02's own claim is that a
# row-count-only assertion would pass unchanged against the OLD head()
# behaviour — these tests assert the timestamp SPAN instead, which head()
# would fail.


def _timestamped_frame(n: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2025-01-01", periods=n, freq="1min"),
            "value": np.arange(n, dtype="float64"),
        }
    )


def test_systematic_sample_spans_the_full_window_not_the_earliest_slice():
    frame = _timestamped_frame(10_000)

    sampled = systematic_sample(frame, 100)

    assert len(sampled) == 100
    # The old `frame.head(100)` would have `timestamp.max()` far short of
    # the window's own last timestamp — this is the exact property a
    # row-count-only check cannot distinguish.
    assert sampled["timestamp"].min() == frame["timestamp"].min()
    assert sampled["timestamp"].max() == frame["timestamp"].max()


def test_systematic_sample_is_identity_when_frame_already_fits():
    frame = _timestamped_frame(50)

    sampled = systematic_sample(frame, 100)

    assert len(sampled) == 50
    pd.testing.assert_frame_equal(sampled, frame)


def test_systematic_sample_indices_are_ascending_and_deduped():
    frame = _timestamped_frame(1_000)

    sampled = systematic_sample(frame, 137)

    assert len(sampled) == 137
    assert sampled.index.is_monotonic_increasing
    assert sampled.index.is_unique


def test_systematic_sample_n_equal_one_returns_first_row_only():
    frame = _timestamped_frame(500)

    sampled = systematic_sample(frame, 1)

    assert len(sampled) == 1
    assert sampled["timestamp"].iloc[0] == frame["timestamp"].iloc[0]


def test_systematic_sample_n_zero_returns_empty():
    frame = _timestamped_frame(500)

    sampled = systematic_sample(frame, 0)

    assert len(sampled) == 0
