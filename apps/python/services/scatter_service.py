"""DS-LAKE-005B-D-T04. Server-side scatter + regression for Step 3.1's
DataAnalysisCard.

Read-only — writes no object, same guarantee `histogram_service.py` and
`boxplot_service.py` make.

REACTIVITY: same read-a-window-then-`apply_operations` shape those two
services use — proven live against real MinIO data for histogram
(DS-LAKE-005B-D-T01) and boxplot (T03).

DECIMATION (ADR-DS-LAKE-005B-D-scatter-decimation): uses
`services.downsample.grid_bin_indices`, NOT the existing `lttb_indices`
path. This task's own scope_note asked to CONFIRM `lttb_indices`'s
applicability rather than assume it — confirmed NOT applicable: LTTB
buckets on the TIME axis, but a scatter's X axis is an arbitrary tag value,
not time, so a time-bucketed sample would preserve temporal shape while
discarding the 2D cloud's density structure, the thing a scatter is read
for. See `grid_bin_indices`'s own docstring for the full reasoning.

STATUS FILTER (ADR-DS-LAKE-005B-D-scatter-status-filter): a pair counts
only when BOTH x and y are Good, matching histogram_service/boxplot_
service's `_good_values` convention. This is a DELIBERATE, TRACKED
divergence from the client's `toScatterPoints` (`lib/preprocessing.ts`),
which is status-blind and would plot (and regress) a Bad cell's `0.0`
MISSING_VALUE hole on a real artifact. `toScatterPoints` itself is NOT
edited to match — it also backs Model Creation Flow evaluation metrics
(`lib/model-metrics.ts`) and two other live chart consumers, so an in-place
fix would silently change model evaluation, a CLAUDE.md Section 10
surface. The chart-parity fixture for this case records the divergence as
a tested fact, not a comment — see `chart-parity-fixtures.test.ts`.

HARD REQUIREMENT (task's own scope_note): the response carries the
decimated `points` for plotting AND regression coefficients fitted over
the FULL Good-filtered frame with the TRUE `n` — fitting on the decimated
sample would ship a wrong slope an engineer reads as real.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from intergrations.object_store import (
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    ObjectStore,
    status_column,
)
from schemas.preprocess import ScatterRequest
from services.cleaning_service import apply_operations
from services.downsample import grid_bin_indices, systematic_sample


def _good_pairs(
    frame: pd.DataFrame, x_tag: str, y_tag: str
) -> tuple[np.ndarray, np.ndarray]:
    """Rows where BOTH tags are Good — see this module's own
    ADR-DS-LAKE-005B-D-scatter-status-filter docstring above."""
    x_values = frame[x_tag].to_numpy(dtype="float64", copy=False)
    y_values = frame[y_tag].to_numpy(dtype="float64", copy=False)
    x_status = frame[status_column(x_tag)].to_numpy(copy=False)
    y_status = frame[status_column(y_tag)].to_numpy(copy=False)
    mask = (x_status == STATUS_GOOD) & (y_status == STATUS_GOOD)
    return x_values[mask], y_values[mask]


def _linear_regression(x: np.ndarray, y: np.ndarray) -> dict[str, float]:
    """Mirrors `lib/preprocessing.ts::linearRegression` bug-for-bug — the
    sum-of-products OLS form, not `numpy.polyfit`/`lstsq` (numerically a
    DIFFERENT, also-valid algorithm that would not agree with the client to
    this task's parity tolerance on the exact n<2 / zero-denominator edges
    the client special-cases)."""
    n = x.size
    if n < 2:
        y0 = float(y[0]) if n == 1 else 0.0
        return {"slope": 0.0, "intercept": y0, "r2": 0.0}

    sx = float(x.sum())
    sy = float(y.sum())
    sxy = float(np.dot(x, y))
    sxx = float(np.dot(x, x))
    syy = float(np.dot(y, y))

    denom = n * sxx - sx * sx
    if denom == 0:
        return {"slope": 0.0, "intercept": sy / n, "r2": 0.0}

    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    r2_denom = denom * (n * syy - sy * sy)
    r2 = 0.0 if r2_denom == 0 else ((n * sxy - sx * sy) ** 2) / r2_denom
    return {"slope": slope, "intercept": intercept, "r2": r2}


def build_scatter(store: ObjectStore, request: ScatterRequest) -> dict[str, Any]:
    """Same read-a-window-then-apply-operations shape as
    `histogram_service.build_histogram`/`boxplot_service.build_boxplot`,
    scoped to exactly the two tags this request asks for.

    Raises `ValueError` for anything the caller can fix (unknown column),
    mapped by the router to 422 — same convention as every other service
    here.
    """
    columns = [
        TIMESTAMP_COLUMN,
        request.x_tag,
        status_column(request.x_tag),
        request.y_tag,
        status_column(request.y_tag),
    ]
    frame = store.get_frame(request.source_key, columns=columns)

    if request.start_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] >= pd.Timestamp(request.start_time)]
    if request.end_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] <= pd.Timestamp(request.end_time)]
    # MODEL-FLOW-014-T02. Was `frame.head(request.sample_rows)` — see
    # `systematic_sample`'s own docstring for why that only ever described
    # the window's earliest contiguous period.
    frame = systematic_sample(frame, request.sample_rows).reset_index(drop=True)

    after = apply_operations(
        frame,
        [operation.to_step() for operation in request.operations],
        request.precision,
    )

    x_values, y_values = _good_pairs(after, request.x_tag, request.y_tag)
    n = int(x_values.size)

    if n < 2:
        # Mirrors `linearRegression`'s own n<2 special case (client returns
        # slope 0, intercept = the single point's y or 0, r2 0) — the same
        # degenerate shape, never a crash.
        regression = _linear_regression(x_values, y_values)
        points = (
            [{"x": float(x_values[0]), "y": float(y_values[0])}] if n == 1 else []
        )
        return {
            "source_key": request.source_key,
            "x_tag": request.x_tag,
            "y_tag": request.y_tag,
            "points": points,
            "n": n,
            **regression,
            "downsampled": False,
        }

    regression = _linear_regression(x_values, y_values)
    sample = grid_bin_indices(x_values, y_values, request.max_points)
    points = [
        {"x": float(x_values[i]), "y": float(y_values[i])} for i in sample.indices
    ]

    return {
        "source_key": request.source_key,
        "x_tag": request.x_tag,
        "y_tag": request.y_tag,
        "points": points,
        "n": n,
        **regression,
        "downsampled": sample.downsampled,
    }
