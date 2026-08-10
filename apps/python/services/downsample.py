"""Server-side LTTB (Largest-Triangle-Three-Buckets) downsampling.

DS-LAKE-005B-A-T06.

Bucket edges are TIME-domain (window span / bucket count), not the textbook
LTTB's index-count domain. This is the one design choice everything else here
depends on: a row-removing cleaning operation (`drop_missing`,
`remove_duplicates`, `remove_outlier`) changes row COUNT but not the window's
time span. Index-based buckets would shift edges between a before/after pair
whenever the count differs, and a visible diff introduced by nothing but the
sampler picking different timestamps would be indistinguishable from a diff
the cleaning operation actually made. Time-domain edges are invariant to row
count, so two frames sharing a time window always share bucket edges, and an
identity recipe (before == after) downsamples to an identical result by
construction — DS-LAKE-005B-A-V06.

`max_points` is a hard ceiling on the RETURNED point count, inclusive of the
first and last source point (LTTB's convention: always keep both ends). The
point budget is therefore `max_points - 2` interior buckets, not
`max_points` buckets plus two endpoints — the latter would silently return
`max_points + 2` and fail "at or under max_points" outright.

Global min/max VALUE protection: pure area-based selection does not
guarantee a spike survives — two comparably extreme points landing in the
same bucket only keep one, and a value that stands out globally but not
against its immediate bucket neighbours can lose the area contest. The
single global max and single global min are force-selected in whichever
bucket they fall into, overriding the area pick for that bucket only. This
is a targeted guarantee (the two most extreme points cannot be dropped), not
a general claim that every local extremum survives — recorded as a known
limitation in `feature_list.preprocessing.json`, not silently assumed.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class DownsampleResult:
    """`indices` are source row positions, ascending, deduplicated."""

    indices: np.ndarray
    bucket_edges: list[str]
    downsampled: bool
    ratio: float


def _time_edges(timestamps: np.ndarray, num_buckets: int) -> np.ndarray:
    """`num_buckets + 1` evenly spaced datetime64[ns] edges over the span."""
    start = timestamps[0].astype("datetime64[ns]").astype("int64")
    end = timestamps[-1].astype("datetime64[ns]").astype("int64")
    if end <= start:
        # Degenerate window (single timestamp, or a clock that didn't
        # advance): fall back to a 1ns span so linspace still produces
        # strictly increasing edges instead of a divide-by-zero bucket.
        end = start + 1
    edges_ns = np.linspace(start, end, num_buckets + 1)
    return edges_ns.astype("int64").astype("datetime64[ns]")


def time_edges(timestamps: np.ndarray, max_points: int) -> np.ndarray:
    """Raw datetime64 edges — what `lttb_indices(edges=...)` actually takes.

    Public (not `_time_edges`) because a preview's shared before/after basis
    must be computed ONCE from the before-window's span and then handed to
    both `lttb_indices` calls, rather than each side re-deriving its own.
    """
    return _time_edges(timestamps, max(1, max_points - 2))


def time_bucket_edges(timestamps: np.ndarray, max_points: int) -> list[str]:
    """ISO-formatted edges, for the response envelope."""
    return [pd.Timestamp(e).isoformat(sep=" ") for e in time_edges(timestamps, max_points)]


def lttb_indices(
    timestamps: np.ndarray,
    values: np.ndarray,
    max_points: int,
    edges: np.ndarray | None = None,
    valid: np.ndarray | None = None,
) -> DownsampleResult:
    """Select at most `max_points` row indices from a single (t, y) series.

    `edges` lets a caller supply pre-computed time-domain edges (the shared
    before/after basis) instead of deriving them from this series' own span
    — required when `values` is the "after" frame, which may have a
    slightly different length than "before" but must bucket against the
    identical boundaries.

    `valid` (boolean, same length as `values`) excludes points from the
    global-extrema PROTECTION only — not from bucket/area selection. Without
    it, a Bad cell's `0.0` hole (`frame_service.MISSING_VALUE`) can win
    `np.argmin` outright on a real artifact and the guard ends up protecting
    a hole instead of the series' actual trough. When every point is
    excluded (a bucket/series with no Good cells at all), protection is
    skipped rather than raised as an error — the area-based selection still
    runs and produces a result, just without the extrema guarantee.
    """
    n = len(timestamps)
    if max_points < 3 or n <= max_points:
        own_edges = (
            edges
            if edges is not None
            else _time_edges(timestamps, max(1, max_points - 2))
        )
        return DownsampleResult(
            indices=np.arange(n),
            bucket_edges=[pd.Timestamp(e).isoformat(sep=" ") for e in own_edges],
            downsampled=False,
            ratio=1.0,
        )

    num_buckets = max_points - 2
    bucket_edges = edges if edges is not None else _time_edges(timestamps, num_buckets)

    bucket_ids = np.searchsorted(bucket_edges, timestamps, side="right") - 1
    bucket_ids = np.clip(bucket_ids, 0, num_buckets - 1)

    if valid is not None:
        masked = np.where(valid, values, np.nan)
        if np.all(np.isnan(masked)):
            # Nothing eligible for protection (e.g. every cell in this
            # window is Bad) — sentinel indices that can never match a real
            # bucket position, so the guard below silently disables itself.
            global_max_idx = global_min_idx = -1
        else:
            global_max_idx = int(np.nanargmax(masked))
            global_min_idx = int(np.nanargmin(masked))
    else:
        global_max_idx = int(np.argmax(values))
        global_min_idx = int(np.argmin(values))

    ts_i64 = timestamps.astype("datetime64[ns]").astype("int64").astype(float)

    selected = [0]
    prev_idx = 0
    for b in range(num_buckets):
        in_bucket = np.flatnonzero((bucket_ids == b) & (np.arange(n) != 0) & (np.arange(n) != n - 1))
        if in_bucket.size == 0:
            continue

        if global_max_idx in in_bucket:
            chosen = global_max_idx
        elif global_min_idx in in_bucket:
            chosen = global_min_idx
        else:
            next_in_bucket = np.flatnonzero(bucket_ids == b + 1)
            if next_in_bucket.size:
                next_avg_t = ts_i64[next_in_bucket].mean()
                next_avg_v = values[next_in_bucket].mean()
            else:
                next_avg_t = ts_i64[n - 1]
                next_avg_v = values[n - 1]

            ax, ay = ts_i64[prev_idx], values[prev_idx]
            bx, by = ts_i64[in_bucket], values[in_bucket]
            area = np.abs((ax - next_avg_t) * (by - ay) - (ax - bx) * (next_avg_v - ay))
            chosen = int(in_bucket[int(np.argmax(area))])

        selected.append(chosen)
        prev_idx = chosen

    selected.append(n - 1)
    indices = np.array(sorted(set(selected)), dtype=np.int64)

    return DownsampleResult(
        indices=indices,
        bucket_edges=[pd.Timestamp(e).isoformat(sep=" ") for e in bucket_edges],
        downsampled=True,
        ratio=round(n / len(indices), 4),
    )
