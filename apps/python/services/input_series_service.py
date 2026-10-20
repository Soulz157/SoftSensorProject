"""MODEL-SERVE-036. Raw input values per tag across scheduled windows, for the
Input Drift card.

Each window's input Parquet (`InferenceWindow.inputKey`) is the cleaned, RAW
frame of the model's own feature columns — the same frame
`inference_window_service._psi_histograms` buckets. Reading it here gives the
trend chart, the per-window table AND the out-of-range counts that grade the
badge from one population, so the three can never disagree.

Out of range is decided by `softsensor_scaling.bucket_value` against the
column's frozen reference edges, never by a plain `v < min or v > max`: a
categorical tag allows a half-gap tolerance past either end, and the badge
must count exactly what the window histograms count.

Long ranges are bucketed to at most `max_points` points per column, each
bucket keeping its own min and max, so a one-minute spike survives
downsampling.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from intergrations.object_store import (
    STATUS_GOOD,
    STATUS_SUFFIX,
    TIMESTAMP_COLUMN,
    status_column,
)
from schemas.preprocess import InferenceWindowInputSeriesRequest
from services.frame_service import utc_iso
from softsensor_scaling import bucket_value

#: Bucket widths a reader can name ("per 15 min"); the smallest that fits wins.
_BUCKET_MINUTES = (1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440)


def _good_rows(frame: pd.DataFrame, column: str) -> tuple[np.ndarray, np.ndarray]:
    """(timestamps, values) of the Good, finite cells of one column. The
    window frame is written after `drop_bad_feature_rows`, so this is a
    no-op on a well-formed window — applied anyway, for the same selection
    `_psi_histograms` makes via `good_values`."""
    values = pd.to_numeric(frame[column], errors="coerce").to_numpy(dtype="float64")
    mask = np.isfinite(values)
    status = status_column(column)
    if status in frame.columns:
        mask &= frame[status].to_numpy(copy=False) == STATUS_GOOD
    stamps = pd.to_datetime(frame[TIMESTAMP_COLUMN]).to_numpy()
    return stamps[mask], values[mask]


def _feature_columns(frames) -> list[str]:
    """Every value column the window frames carry, in first-seen order —
    the model's own feature columns (the frame is narrowed to them before it
    is written), minus the timestamp and the `__status` sidecars."""
    seen: dict[str, None] = {}
    for frame in frames:
        for column in frame.columns:
            if column == TIMESTAMP_COLUMN or column.endswith(STATUS_SUFFIX):
                continue
            seen.setdefault(column, None)
    return list(seen)


def _bucket_minutes(span_minutes: float, max_points: int) -> int:
    need = span_minutes / max_points
    for width in _BUCKET_MINUTES:
        if width >= need:
            return width
    return int(math.ceil(need / 1440) * 1440)


def _iso(stamp: Any) -> str:
    """A frame stamp (naive Bangkok wall clock) as a UTC ISO string."""
    return utc_iso(pd.Timestamp(stamp))


def build_input_series(
    store, request: InferenceWindowInputSeriesRequest
) -> dict[str, Any]:
    refs = request.references
    frames: list[tuple[Any, pd.DataFrame]] = []
    missing = 0
    for window in request.windows:
        try:
            frame = store.get_frame(window.key)
        except Exception:
            missing += 1
            continue
        if TIMESTAMP_COLUMN not in frame.columns:
            missing += 1
            continue
        frames.append((window, frame))

    wanted = list(request.columns) or _feature_columns(f for _, f in frames)
    rows: dict[str, list[tuple[Any, float, int]]] = {c: [] for c in wanted}
    windows: dict[str, list[dict[str, Any]]] = {c: [] for c in wanted}
    counts: dict[str, list[int] | None] = {}
    for column in wanted:
        ref = refs.get(column)
        if ref is None:
            counts[column] = None
        else:
            n_bins = (
                len(ref.edges) if ref.bin_mode == "categorical" else len(ref.edges) - 1
            )
            counts[column] = [0] * max(n_bins, 0)

    for window, frame in frames:
        for column in wanted:
            if column not in frame.columns:
                continue
            stamps, values = _good_rows(frame, column)
            ref = refs.get(column)
            col_counts = counts[column]
            below = above = 0
            for stamp, value in zip(stamps, values):
                overflow = None
                if ref is not None:
                    idx, overflow = bucket_value(float(value), ref.edges, ref.bin_mode)
                    if overflow == "below":
                        below += 1
                    elif overflow == "above":
                        above += 1
                    elif idx is not None and col_counts is not None:
                        col_counts[idx] += 1
                rows[column].append((stamp, float(value), 1 if overflow else 0))
            windows[column].append(
                {
                    "window_start": window.window_start,
                    "window_end": window.window_end,
                    "n": int(values.size),
                    "min": float(values.min()) if values.size else None,
                    "max": float(values.max()) if values.size else None,
                    "mean": float(values.mean()) if values.size else None,
                    "below": below,
                    "above": above,
                }
            )

    columns: dict[str, Any] = {}
    for column in wanted:
        col_rows = sorted(rows[column], key=lambda r: r[0])
        col_windows = sorted(
            windows[column], key=lambda w: w["window_start"], reverse=True
        )
        values = np.array([r[1] for r in col_rows], dtype="float64")
        last_out = next((r[0] for r in reversed(col_rows) if r[2]), None)

        resolution = "raw"
        bucket: int | None = None
        if len(col_rows) <= request.max_points:
            points = [
                {"t": _iso(s), "value": v, "min": v, "max": v, "out_of_range": o}
                for s, v, o in col_rows
            ]
        else:
            first = pd.Timestamp(col_rows[0][0])
            last = pd.Timestamp(col_rows[-1][0])
            span = max((last - first).total_seconds() / 60, 1.0)
            bucket = _bucket_minutes(span, request.max_points)
            resolution = "bucketed"
            frame = pd.DataFrame(
                {
                    "t": pd.to_datetime([r[0] for r in col_rows]),
                    "v": values,
                    "o": [r[2] for r in col_rows],
                }
            )
            agg = frame.groupby(frame["t"].dt.floor(f"{bucket}min")).agg(
                value=("v", "mean"), lo=("v", "min"), hi=("v", "max"), out=("o", "sum")
            )
            points = [
                {
                    "t": _iso(stamp),
                    "value": float(r.value),
                    "min": float(r.lo),
                    "max": float(r.hi),
                    "out_of_range": int(r.out),
                }
                for stamp, r in agg.iterrows()
            ]

        columns[column] = {
            "resolution": resolution,
            "bucket_minutes": bucket,
            "points": points,
            "windows": col_windows,
            "total": int(values.size),
            "below": sum(w["below"] for w in col_windows),
            "above": sum(w["above"] for w in col_windows),
            "counts": counts[column],
            "live_min": float(values.min()) if values.size else None,
            "live_max": float(values.max()) if values.size else None,
            "live_mean": float(values.mean()) if values.size else None,
            "last_out_of_range_at": _iso(last_out) if last_out is not None else None,
        }

    return {"columns": columns, "missing": missing}
