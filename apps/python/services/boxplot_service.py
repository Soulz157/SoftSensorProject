"""DS-LAKE-005B-D-T03. Server-side box plot for Step 3.1's DataAnalysisCard.

Read-only — writes no object, same guarantee `preview_service.py` and
`histogram_service.py` make.

REACTIVITY: same read-a-window-then-`apply_operations` shape `histogram_
service.build_histogram` uses — proven live there against real MinIO data
(DS-LAKE-005B-D-T01). Duplicated inline here rather than imported: neither
function calls `build_preview` itself (it returns a before/after aggregate,
not a raw frame), each re-runs the same four-line window sequence instead.

PARITY (bug-for-bug against `apps/client/lib/data-quality.ts::tagBoxplotStats`
and `tag-boxplot-chart.tsx::hasData`, both read directly before writing this):
linear-interpolated quartiles (`idx = p*(n-1)`, floor/ceil, matching the
client's own `quantile()` — NOT `column_stats_service.percentile_bounds()`,
which rounds to 6dp and would fail this task's own parity tolerance, and NOT
`column_stats_service._outlier_count`'s POSITIONAL quartile method, which is
a different number computed for a different purpose (`outlier_count` sidecar
field vs. this chart's own 1.5×IQR fence) — checked directly, not assumed
compatible), and 1.5×IQR whisker/outlier fence — all ported bug-for-bug.
The QUALIFYING check is the one deliberate exception: `_qualifies` gates
on `count > 0`, NOT a port of `tag-boxplot-chart.tsx::hasData`
(`min != max or median != 0`) — that predicate mislabels an all-zero-
valued tag as insufficient data, a real user-facing correctness issue
(see `_qualifies`' own docstring), not a numeric-parity one. DS-LAKE-
005B-D-T02 (parity fixture gate) is what proves the VALUES stay true;
qualification is not a value it would ever fixture-test.
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
from schemas.preprocess import BoxplotRequest
from services.cleaning_service import apply_operations


def _good_values(frame: pd.DataFrame, tag: str) -> np.ndarray:
    """Mirrors `column_stats_service._good_values` — kept local rather than
    imported, matching `histogram_service._good_values`'s own precedent."""
    values = frame[tag].to_numpy(dtype="float64", copy=False)
    statuses = frame[status_column(tag)].to_numpy(copy=False)
    return values[statuses == STATUS_GOOD]


def _quantile(sorted_vals: np.ndarray, p: float) -> float:
    """Mirrors `lib/data-quality.ts::quantile` bug-for-bug: linear
    interpolation over an ALREADY-SORTED array, `0 <= p <= 1`. Deliberately
    UNROUNDED, unlike `column_stats_service.percentile_bounds()` — that
    function rounds to 6dp for a value-clip bound where that precision is
    fine; a chart parity fixture asserting near-exact agreement (rel_tol
    1e-9) is not, so this is its own small function, not a reuse.
    """
    n = sorted_vals.size
    if n == 1:
        return float(sorted_vals[0])
    idx = p * (n - 1)
    lo = int(np.floor(idx))
    hi = int(np.ceil(idx))
    lo_val = float(sorted_vals[lo])
    hi_val = float(sorted_vals[hi])
    return lo_val + (hi_val - lo_val) * (idx - lo)


#: Mirrors `EMPTY_BOXPLOT_STATS` (`lib/data-quality.ts`) — the all-zero
#: shape `tagBoxplotStats` returns for 0 Good values, which `hasData`
#: (`min != max or median != 0`) always fails.
_EMPTY_STATS: dict[str, Any] = {
    "min": 0.0,
    "q1": 0.0,
    "median": 0.0,
    "mean": 0.0,
    "q3": 0.0,
    "max": 0.0,
    "whisker_low": 0.0,
    "whisker_high": 0.0,
    "outliers_full": [],
    "count": 0,
}


def _boxplot_stats(good: np.ndarray) -> dict[str, Any]:
    """Mirrors `lib/data-quality.ts::tagBoxplotStats` bug-for-bug."""
    if good.size == 0:
        return dict(_EMPTY_STATS)

    sorted_vals = np.sort(good)
    vmin = float(sorted_vals[0])
    vmax = float(sorted_vals[-1])
    q1 = _quantile(sorted_vals, 0.25)
    q3 = _quantile(sorted_vals, 0.75)
    median = _quantile(sorted_vals, 0.5)
    iqr = q3 - q1
    whisker_low = max(vmin, q1 - 1.5 * iqr)
    whisker_high = min(vmax, q3 + 1.5 * iqr)
    fence_lo, fence_hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers_full = sorted_vals[
        (sorted_vals < fence_lo) | (sorted_vals > fence_hi)
    ].tolist()
    mean = float(good.mean())

    return {
        "min": vmin,
        "q1": q1,
        "median": median,
        "mean": mean,
        "q3": q3,
        "max": vmax,
        "whisker_low": whisker_low,
        "whisker_high": whisker_high,
        "outliers_full": outliers_full,
        "count": int(good.size),
    }


def _qualifies(stats: dict[str, Any]) -> bool:
    """DELIBERATELY NOT a port of `tag-boxplot-chart.tsx::hasData`
    (`min != max or median != 0`), unlike every other predicate in this
    module. Caught in review: that check mislabels a tag whose Good values
    are ALL exactly 0.0 (e.g. a valve-position or fault-flag tag stuck low
    for the whole window) as insufficient data, when the true situation is
    real data that happens to be constant at zero. That's not a numeric-
    parity concern T02's fixture harness would ever catch (it asserts
    values, not which tags got classified insufficient) — it's a
    USER-FACING correctness issue: `insufficient_tags` drives real product
    copy ("Not enough values for X"), and that copy would be false. Gating
    on `count > 0` instead fixes exactly that one edge case and changes
    nothing else — `hasData` and `count > 0` agree on every input except
    the all-zero one."""
    return stats["count"] > 0


def build_boxplot(store: ObjectStore, request: BoxplotRequest) -> dict[str, Any]:
    """Same read-a-window-then-apply-operations shape as `build_histogram`,
    scoped to exactly the tags this request asks for.

    Raises `ValueError` for anything the caller can fix (unknown column),
    mapped by the router to 422 — same convention as every other service
    here.
    """
    columns = [TIMESTAMP_COLUMN]
    for tag in request.tags:
        columns.append(tag)
        columns.append(status_column(tag))

    frame = store.get_frame(request.source_key, columns=columns)

    if request.start_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] >= pd.Timestamp(request.start_time)]
    if request.end_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN] <= pd.Timestamp(request.end_time)]
    frame = frame.head(request.sample_rows).reset_index(drop=True)

    after = apply_operations(
        frame,
        [operation.to_step() for operation in request.operations],
        request.precision,
    )

    tags_out: list[dict[str, Any]] = []
    insufficient: list[str] = []
    for tag in request.tags:
        good = _good_values(after, tag)
        stats = _boxplot_stats(good)
        if not _qualifies(stats):
            insufficient.append(tag)
            continue
        outliers_full = stats["outliers_full"]
        tags_out.append(
            {
                "tag": tag,
                "min": stats["min"],
                "q1": stats["q1"],
                "median": stats["median"],
                "mean": stats["mean"],
                "q3": stats["q3"],
                "max": stats["max"],
                "whisker_low": stats["whisker_low"],
                "whisker_high": stats["whisker_high"],
                "outliers": outliers_full[: request.outlier_cap],
                "outlier_count": len(outliers_full),
                "count": stats["count"],
            }
        )

    return {
        "source_key": request.source_key,
        "tags": tags_out,
        "insufficient_tags": insufficient,
    }
