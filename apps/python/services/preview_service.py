"""Before/after preview for a cleaning pipeline. Reads only — never writes.

The point of a preview is to let someone see what an operation would do before
committing a dataset version, so this path must not create objects or rows.
`test_preview_service.py` asserts that directly rather than trusting the code
to stay honest.

Sampling caveat
---------------
A preview runs against a HEAD WINDOW of the artifact (`sample_rows`), not the
whole thing. That makes some results indicative rather than exact:
`mean`/`median` fills and the IQR fences are derived from the sample, and
row-removing operations only report what they removed inside the window, so the
committed run can differ. When the artifact is larger than the window the
response sets `sampled: true` and carries an explicit warning — silently
presenting sample-derived numbers as final would be the worst option.

The cap bounds COMPUTE, not I/O: `ObjectStore.get_frame_head` still reads the
whole object before slicing, because row-group pushdown needs Parquet metadata
this reader does not use yet. So the window keeps the pandas work small while a
large artifact is still read in full — do not read this cap as a guarantee
about read time.

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
from schemas.preprocess import PreviewRequest
from services.cleaning_service import apply_operations

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
    }


def sampling_warnings(request: PreviewRequest, sampled: bool) -> list[str]:
    if not sampled:
        return []

    warnings = [
        f"Preview computed on the first {request.sample_rows:,} rows, not the "
        "whole dataset. Row counts and statistics are indicative."
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


def build_preview(store: ObjectStore, request: PreviewRequest) -> dict[str, Any]:
    """Read a capped window, apply the operations in memory, and compare.

    Raises `ValueError` for anything the caller can fix (unknown column,
    unsupported operation); the router maps that to 422.
    """
    # `source_row_count` must be the artifact's REAL height, not the window's.
    # Reporting the window there would make `sampled: true` unfalsifiable — the
    # client would be told "this is a sample" and handed a total that equals
    # the sample, with no way to see how much it is missing.
    before, source_row_count = store.get_frame_head(
        request.source_key, request.sample_rows
    )
    sampled = source_row_count > request.sample_rows

    after = apply_operations(
        before,
        [operation.to_step() for operation in request.operations],
        request.precision,
    )

    before_summary = summarise(before, request.preview_rows)
    after_summary = summarise(after, request.preview_rows)

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
        "warnings": sampling_warnings(request, sampled),
    }
