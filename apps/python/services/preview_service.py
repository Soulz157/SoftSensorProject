"""Before/after preview for a cleaning pipeline. Reads only — never writes.

The point of a preview is to let someone see what an operation would do before
committing a dataset version, so this path must not create objects or rows.
`test_preview_service.py` asserts that directly rather than trusting the code
to stay honest.

Sampling caveat
---------------
A preview runs against a HEAD WINDOW (`sample_rows`) of the requested view —
the whole artifact by default, or a tag- and time-narrowed slice of it when
`tags`/`start_time`/`end_time` are given (DS-LAKE-005B-A-T04). That makes some
results indicative rather than exact: `mean`/`median` fills and the IQR fences
are derived from the sample, and row-removing operations only report what they
removed inside the window, so the committed run can differ. When the view is
larger than the window the response sets `sampled: true` and carries an
explicit warning — silently presenting sample-derived numbers as final would
be the worst option.

`sample_rows`' head cut is BYPASSED when `max_points` is set
(DS-LAKE-005B-A-T06): a chart series downsampled via LTTB needs the FULL
window as its input, because a local extremum past the head cut is not
merely harder to select, it was never in the input at all. That path is
bounded instead by `MAX_DOWNSAMPLE_WINDOW_ROWS` and never sets `sampled` —
`sampled`/`sampling_warnings` describe the small `rows` table, `downsampled`/
`downsample_warnings` describe the separate `series` payload. See
`_apply_downsampling`.

The cap bounds COMPUTE, not I/O: `ObjectStore.get_frame` still reads the whole
object before column projection and time filtering are applied in pandas here
(the same pattern `artifact_service.rows` uses), because row-group pushdown
needs Parquet metadata this reader does not use yet. So the window keeps the
pandas work small while a large artifact is still downloaded in full — do not
read this cap as a guarantee about read time. This applies whether or not
`max_points` bypassed the `sample_rows` cut specifically; either way the I/O
was never bounded by either cap.

Measured on local MinIO: a 10M-row, 4-tag, 396 MB artifact previews in 0.60s,
comfortably inside PYTHON_TIMEOUT.metadata (30s). The binding constraint is
therefore memory (the whole frame is resident) and link speed to storage, not
the timeout. Pushdown is filed as deferred work in
`feature_list.preprocessing.json`.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from intergrations.object_store import (
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    ObjectStore,
    status_column,
    tag_columns,
)
from schemas.preprocess import MAX_DOWNSAMPLE_WINDOW_ROWS, PreviewRequest
from services.column_stats_service import percentile_bounds
from services.cleaning_service import apply_operations
from services.downsample import lttb_indices, time_edges

# Operations whose sampled result can legitimately disagree with the committed
# run. Two distinct reasons, both worth warning about:
#
#   * stat-derived — the fill value or the fence comes from the sample;
#   * row-removing — the row count they report is only what they removed inside
#     the window, and `delta.row_count` is the headline number a user decides
#     on. These carry `method=None`, so the tuple must be matched on a
#     normalised `method or None` or they never match at all.
SAMPLE_SENSITIVE = {
    ("fill_missing", "mean"),
    ("fill_missing", "median"),
    ("remove_outlier", "iqr"),
    ("remove_outlier", "zscore"),
    ("drop_missing", None),
    ("remove_duplicates", None),
}

_STATUS_NAMES = {0: "Good", 1: "Bad", 2: "Questionable"}


def _finite(value: Any) -> float | None:
    """None for NaN/inf so the JSON response never carries a non-finite float."""
    if value is None:
        return None
    number = float(value)
    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, 6)


def column_stats(frame: pd.DataFrame, tag: str) -> dict[str, Any]:
    """Per-column summary computed over GOOD cells only.

    Bad cells hold the `0.0` hole from `frame_service.MISSING_VALUE`; including
    them would drag every mean toward zero and make the preview misleading.

    `percentiles` (DS-LAKE-005B-B-T01, edit 3) makes THIS function the
    "recompute under current rules" mode a value-clip bound needs: unlike
    `column_stats_service.build_column_stats` (a snapshot of the COMMITTED
    artifact), this runs over whatever `operations` the caller just applied —
    live crop/exclusion/statistical rules included — so a bound read from
    here reflects what the pipeline would actually see, not a stale snapshot.
    Subject to the SAME sampling caveat as `mean`/`median` above (module
    docstring): when the view exceeds `sample_rows`, this is indicative, not
    exact, and the response's `sampled`/`sampling_warnings` say so.
    """
    values = frame[tag].to_numpy(dtype="float64", copy=False)
    statuses = frame[status_column(tag)].to_numpy(dtype="int8", copy=False)
    good = values[statuses == STATUS_GOOD]

    total = int(len(frame))
    missing = int(total - good.size)

    if good.size == 0:
        return {
            "tag": tag,
            "count": total,
            "missing": missing,
            "missing_pct": 100.0 if total else 0.0,
            "min": None,
            "max": None,
            "mean": None,
            "median": None,
            "std": None,
            "percentiles": None,
        }

    return {
        "tag": tag,
        "count": total,
        "missing": missing,
        "missing_pct": round(missing / total * 100, 4) if total else 0.0,
        "min": _finite(good.min()),
        "max": _finite(good.max()),
        "mean": _finite(good.mean()),
        "median": _finite(np.median(good)),
        # Sample std (ddof=1) is the descriptive convention here. It is NOT the
        # population std the zscore OPERATION uses — different jobs.
        "std": _finite(good.std(ddof=1)) if good.size > 1 else 0.0,
        "percentiles": percentile_bounds(good),
    }


def sample_rows(frame: pd.DataFrame, limit: int) -> list[dict[str, Any]]:
    """First `limit` rows in the wide cell shape the client renders."""
    tags = tag_columns(frame)
    rows: list[dict[str, Any]] = []

    for record in frame.head(limit).to_dict(orient="records"):
        timestamp = record[TIMESTAMP_COLUMN]
        rows.append(
            {
                "timestamp": (
                    timestamp.isoformat(sep=" ")
                    if hasattr(timestamp, "isoformat")
                    else str(timestamp)
                ),
                "cells": {
                    tag: {
                        "value": _finite(record[tag]) or 0.0,
                        "status": _STATUS_NAMES.get(
                            int(record[status_column(tag)]), "Bad"
                        ),
                    }
                    for tag in tags
                },
            }
        )
    return rows


def summarise(frame: pd.DataFrame, preview_rows: int) -> dict[str, Any]:
    tags = tag_columns(frame)
    columns = [column_stats(frame, tag) for tag in tags]

    missing_cells = sum(column["missing"] for column in columns)
    total_cells = len(frame) * len(tags)

    return {
        "row_count": int(len(frame)),
        # LOGICAL tags only — the frame carries 2N+1 physical columns.
        "column_count": len(tags),
        "missing_cells": missing_cells,
        "missing_pct": (
            round(missing_cells / total_cells * 100, 4) if total_cells else 0.0
        ),
        "columns": columns,
        "rows": sample_rows(frame, preview_rows),
        # Downsampling defaults — build_preview overwrites these three when
        # max_points is requested. Set here so PreviewSide always validates,
        # whether or not the caller asked for a chart series.
        "downsampled": False,
        "downsample_ratio": None,
        "series": None,
    }


def sampling_warnings(request: PreviewRequest, sampled: bool) -> list[str]:
    if not sampled:
        return []

    # "the whole dataset" would be misleading once a tag/time filter is in
    # play: the user asked for a WINDOW, and the sample is the first N rows
    # OF THAT WINDOW, not of the artifact — DS-LAKE-005B-A-T04.
    scope = (
        "the requested window"
        if (request.tags is not None or request.start_time or request.end_time)
        else "the whole dataset"
    )
    warnings = [
        f"Preview computed on the first {request.sample_rows:,} rows, not "
        f"{scope}. Row counts and statistics are indicative."
    ]

    affected = sorted(
        {
            f"{op.type}{'/' + op.method if op.method else ''}"
            for op in request.operations
            # `or None` so an operation sent with `method: ""` matches the same
            # entry as one sent with `method: null`.
            if (op.type, op.method or None) in SAMPLE_SENSITIVE
        }
    )
    if affected:
        warnings.append(
            "These operations derive their parameters from the data, so the "
            f"committed run may differ from this preview: {', '.join(affected)}."
        )
    return warnings


def downsample_warnings(request: PreviewRequest, was_downsampled: bool) -> list[str]:
    """Separate from `sampling_warnings` on purpose: `sampled` describes the
    small head-cut `rows` table (bypassed entirely on the max_points path —
    see `build_preview`), `downsampled` describes the LTTB-reduced `series`.
    Conflating the two would resurrect the exact misleading-text bug fixed
    for `sampled` in T04 (a caveat claiming the wrong reason for imprecision).
    """
    if not was_downsampled or request.max_points is None:
        return []
    return [
        f"Chart series reduced to at most {request.max_points:,} points via "
        "LTTB across the full requested window. Values between selected "
        "points are not shown; use the row-level table for exact figures."
    ]


def build_preview(store: ObjectStore, request: PreviewRequest) -> dict[str, Any]:
    """Read a capped window, apply the operations in memory, and compare.

    `tags` drives real Parquet column projection, same as
    `artifact_service.rows` — an unknown requested tag reaches `pyarrow` as
    `ArrowInvalid`, a `ValueError` subclass, which the router already maps to
    422 with no extra handling. `start_time`/`end_time` narrow the frame to a
    time WINDOW before `sample_rows` caps it, so a Bad stretch in the middle
    of a multi-year artifact is reachable without downloading rows first.

    Raises `ValueError` for anything the caller can fix (unknown column,
    unsupported operation); the router maps that to 422.
    """
    columns = None
    if request.tags is not None:
        columns = [TIMESTAMP_COLUMN]
        for tag in request.tags:
            columns.append(tag)
            columns.append(status_column(tag))

    frame = store.get_frame(request.source_key, columns=columns)

    is_filtered = request.start_time is not None or request.end_time is not None
    if request.start_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] >= pd.Timestamp(request.start_time)]
    if request.end_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] <= pd.Timestamp(request.end_time)]
    if is_filtered:
        frame = frame.reset_index(drop=True)

    # `source_row_count` must be the WINDOW's real height, not the sample's.
    # Reporting the sample there would make `sampled: true` unfalsifiable —
    # the client would be told "this is a sample" and handed a total that
    # equals the sample, with no way to see how much it is missing.
    source_row_count = int(len(frame))

    downsampling = request.max_points is not None
    if downsampling:
        # V05's "local extrema of the source series survive the reduction"
        # cannot hold if the series was truncated to sample_rows BEFORE LTTB
        # ever saw it — a trough past the head cut is not merely hard to
        # pick, it is absent from the input entirely. So this path skips the
        # head cut and runs operations over the FULL window, bounded by its
        # own ceiling instead of sample_rows'.
        if source_row_count > MAX_DOWNSAMPLE_WINDOW_ROWS:
            raise ValueError(
                f"Window has {source_row_count:,} rows; a downsampled preview "
                f"(max_points set) is capped at {MAX_DOWNSAMPLE_WINDOW_ROWS:,} "
                "rows regardless of max_points. Narrow the tags or time range."
            )
        before = frame.reset_index(drop=True)
        sampled = False  # no head truncation occurred on this path
    else:
        before = frame.head(request.sample_rows).reset_index(drop=True)
        sampled = source_row_count > request.sample_rows

    after = apply_operations(
        before,
        [operation.to_step() for operation in request.operations],
        request.precision,
    )

    before_summary = summarise(before, request.preview_rows)
    after_summary = summarise(after, request.preview_rows)

    bucket_edges: list[str] | None = None
    if downsampling:
        bucket_edges = _apply_downsampling(before, after, before_summary, after_summary, request)

    return {
        "source_key": request.source_key,
        "sampled": sampled,
        "sampled_rows": int(len(before)),
        "source_row_count": source_row_count,
        "before": before_summary,
        "after": after_summary,
        "delta": {
            "row_count": after_summary["row_count"] - before_summary["row_count"],
            "column_count": (
                after_summary["column_count"] - before_summary["column_count"]
            ),
            "missing_cells": (
                after_summary["missing_cells"] - before_summary["missing_cells"]
            ),
            "missing_pct": round(
                after_summary["missing_pct"] - before_summary["missing_pct"], 4
            ),
        },
        # Echoes what was actually applied — same DS-LAKE-005B-A-T02 lesson:
        # a filtered source_row_count that does not announce itself is a
        # client-side correctness trap.
        "filtered": is_filtered,
        "start_time": request.start_time,
        "end_time": request.end_time,
        "max_points": request.max_points,
        "bucket_edges": bucket_edges,
        "warnings": sampling_warnings(request, sampled)
        + downsample_warnings(
            request,
            bool(before_summary["downsampled"]) or bool(after_summary["downsampled"]),
        ),
    }


def _series_rows(frame: pd.DataFrame, indices) -> list[dict[str, Any]]:
    """`sample_rows` reused at ARBITRARY (non-head) positions: `.head(limit)`
    on a frame already sliced to exactly `len(indices)` rows is a no-op, so
    this is the same row-shaping code, not a second implementation of it."""
    subset = frame.iloc[indices].reset_index(drop=True)
    return sample_rows(subset, limit=len(subset))


def _apply_downsampling(
    before: pd.DataFrame,
    after: pd.DataFrame,
    before_summary: dict[str, Any],
    after_summary: dict[str, Any],
    request: PreviewRequest,
) -> list[str] | None:
    """Mutates `before_summary`/`after_summary` in place with `series`,
    `downsampled`, `downsample_ratio`. Returns the shared bucket edges (or
    None if there was no tag to drive selection with, e.g. an empty window).
    """
    tags = tag_columns(before)
    if not tags:
        return None
    reference_tag = request.tags[0] if request.tags else tags[0]
    if reference_tag not in tags:
        return None

    before_ts = before[TIMESTAMP_COLUMN].to_numpy()
    edges = time_edges(before_ts, request.max_points)
    shared_bucket_edges: list[str] | None = None

    for frame, summary in ((before, before_summary), (after, after_summary)):
        ts = frame[TIMESTAMP_COLUMN].to_numpy()
        values = frame[reference_tag].to_numpy(dtype="float64", copy=False)
        # A Bad cell holds the `0.0` hole, not NaN — without this mask the
        # extrema guard in lttb_indices could "protect" a hole instead of
        # the series' real trough.
        valid = frame[status_column(reference_tag)].to_numpy() == STATUS_GOOD
        result = lttb_indices(ts, values, request.max_points, edges=edges, valid=valid)

        summary["downsampled"] = result.downsampled
        summary["downsample_ratio"] = result.ratio if result.downsampled else None
        summary["series"] = _series_rows(frame, result.indices)
        if shared_bucket_edges is None:
            # Both calls were given the SAME `edges` array, so both results'
            # bucket_edges are identical by construction — captured once
            # from whichever side ran first rather than recomputed.
            shared_bucket_edges = result.bucket_edges

    return shared_bucket_edges
