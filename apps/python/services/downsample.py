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

import math
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


def systematic_sample(frame: pd.DataFrame, n: int) -> pd.DataFrame:
    """MODEL-FLOW-014-T02. Evenly-spaced sample of at most `n` rows spanning
    the frame's FULL span, not its earliest contiguous slice.

    Replaces `frame.head(n)`, which every chart service (`histogram_service`,
    `boxplot_service`, `scatter_service`, `correlation_matrix_service`) used
    to apply after its own time-range filter. On time-ordered data `head()`
    returns only the window's EARLIEST period — a box/histogram/scatter/
    correlation computed over that describes a narrower, different
    population than the one the caller asked for, while looking exactly like
    the real answer. A box plot summarises a DISTRIBUTION; `head()` on
    sorted-by-time data samples one contiguous period, a different claim
    wearing the same shape.

    Always includes the frame's own first and last row (when `n >= 2`) so
    the sample's timestamp bounds equal the frame's — the property
    MODEL-FLOW-014-V02 asserts directly, since a row-count-only check would
    pass unchanged against the old `head()` behaviour.
    """
    total = len(frame)
    if total <= n:
        return frame
    if n <= 0:
        return frame.iloc[0:0]
    if n == 1:
        return frame.iloc[[0]]

    step = total / n
    idx = (np.arange(n) * step).astype(np.int64)
    idx = np.clip(idx, 0, total - 1)
    idx[-1] = total - 1
    idx = np.unique(idx)
    return frame.iloc[idx]


@dataclass(frozen=True)
class GridSampleResult:
    """`indices` are source row positions into the ORIGINAL (x, y) arrays,
    ascending, deduplicated — one representative point per OCCUPIED grid
    cell (the point nearest that cell's centroid), so a sparse region
    returns fewer points than a dense one at the same `max_points` budget,
    rather than every cell being padded to look equally full."""

    indices: np.ndarray
    grid_dims: tuple[int, int]
    downsampled: bool
    ratio: float


def grid_bin_indices(
    x: np.ndarray,
    y: np.ndarray,
    max_points: int,
    valid: np.ndarray | None = None,
) -> GridSampleResult:
    """Select at most `max_points` (x, y) row indices via 2D grid binning.

    ADR-DS-LAKE-005B-D-scatter-decimation (this task's own scope_note asked
    to CONFIRM `lttb_indices`'s applicability rather than assume it —
    confirmed NOT applicable): `lttb_indices` above buckets on the TIME
    axis, but a scatter plot's X axis is an arbitrary tag VALUE, not time —
    time-bucketed selection would retain points chosen for temporal shape
    while discarding the 2D cloud's DENSITY structure, which is the thing a
    scatter is read for. This bins the (x, y) plane instead: a roughly
    square grid sized to `max_points` and the observed aspect ratio, one
    representative point per occupied cell. Cell OCCUPANCY determines the
    returned count, not a fixed resolution — a sparse region legitimately
    returns fewer points; padding to exactly `max_points` would fabricate
    points nobody observed.

    `valid` (boolean, same length as `x`/`y`) EXCLUDES points from
    consideration entirely — unlike `lttb_indices`'s narrower "excluded
    from extrema protection only", a scatter has no bucket/area fallback
    for an excluded point, so it must never be selected. Callers pass
    Good-only validity (ADR-DS-LAKE-005B-D-scatter-status-filter) so a Bad
    cell's `0.0` MISSING_VALUE hole can never appear in the plotted cloud.
    """
    n = len(x)
    keep = np.flatnonzero(valid) if valid is not None else np.arange(n)

    if keep.size == 0:
        return GridSampleResult(
            indices=np.array([], dtype=np.int64),
            grid_dims=(0, 0),
            downsampled=False,
            ratio=1.0,
        )

    if max_points < 1 or keep.size <= max_points:
        return GridSampleResult(
            indices=np.sort(keep),
            grid_dims=(0, 0),
            downsampled=False,
            ratio=1.0,
        )

    xs = x[keep]
    ys = y[keep]
    x_min, x_max = float(xs.min()), float(xs.max())
    y_min, y_max = float(ys.min()), float(ys.max())
    x_range = x_max - x_min
    y_range = y_max - y_min

    # Roughly square grid sized to the observed aspect ratio, so a wide-flat
    # cloud isn't binned into tall thin cells that never fill.
    aspect = (x_range / y_range) if y_range > 0 else 1.0
    aspect = aspect if math.isfinite(aspect) and aspect > 0 else 1.0
    cols = max(1, round(math.sqrt(max_points * aspect)))
    rows = max(1, round(max_points / cols))

    x_width = x_range / cols if x_range > 0 else 1.0
    y_height = y_range / rows if y_range > 0 else 1.0

    col_ids = (
        np.clip(((xs - x_min) / x_width).astype(np.int64), 0, cols - 1)
        if x_range > 0
        else np.zeros(keep.size, dtype=np.int64)
    )
    row_ids = (
        np.clip(((ys - y_min) / y_height).astype(np.int64), 0, rows - 1)
        if y_range > 0
        else np.zeros(keep.size, dtype=np.int64)
    )
    cell_ids = row_ids * cols + col_ids

    # The point nearest its cell's centroid represents that cell — a
    # genuinely representative point, not an arbitrary first-seen one.
    centroid_x = x_min + (col_ids + 0.5) * x_width
    centroid_y = y_min + (row_ids + 0.5) * y_height
    dist_sq = (xs - centroid_x) ** 2 + (ys - centroid_y) ** 2

    # Primary sort key is the LAST argument to `lexsort` (numpy convention):
    # groups by cell, then orders each group by ascending distance so the
    # first row of each group is that cell's nearest-to-centroid point.
    order = np.lexsort((dist_sq, cell_ids))
    sorted_cell_ids = cell_ids[order]
    first_in_group = np.concatenate(
        ([True], sorted_cell_ids[1:] != sorted_cell_ids[:-1])
    )
    chosen = np.sort(keep[order[first_in_group]])

    return GridSampleResult(
        indices=chosen,
        grid_dims=(cols, rows),
        downsampled=True,
        ratio=round(keep.size / chosen.size, 4) if chosen.size else 1.0,
    )
