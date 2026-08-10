"""Per-tag aggregate sidecar (DS-LAKE-005B-A-T07).

`column_stats.json` is written beside the data at write time (`_commit` in
`artifact_service.py`) and read back WITHOUT ever opening `data.parquet` —
that is the entire point (`data.parquet` for an 8,000-tag artifact is the
thing this sidecar exists to avoid touching just to answer "how healthy is
tag X"). `services/artifact_service.py::column_stats` proves that with
`RecordingStore.get_frame_calls == 0` while serving a synthetic 8,000-tag
artifact (DS-LAKE-005B-A-V07).

Field definitions, since none of this vocabulary existed anywhere in the
repo before this task (grepped, confirmed empty):

* `coverage` / `null_pct` — GOOD-cell percentage and its complement, same
  convention as `preview_service.column_stats` (Bad cells hold the `0.0`
  hole and are excluded from every other stat below too).
* `outlier_count` — a READ-ONLY count using the same 1.5*IQR fence
  `cleaning_service._op_outlier_median` uses to CLIP values, but counting
  rather than mutating, and over GOOD cells only (that op considers every
  cell; this sidecar's own convention is Good-only, stated explicitly here
  because the two are easy to conflate).
* `drift` — signed `mean - parent_mean` for the SAME tag on the artifact's
  immediate parent (`parentArtifactId`), decided via AskUserQuestion during
  this task (parent-artifact comparison, not within-window). `None` when
  there is no parent (a BRONZE root — confirmed by
  `test_materialized_artifact_has_no_parent` — has nothing to drift from,
  which is a real "no comparison possible", not a real "zero drift") or
  when either side has no Good cells for the tag to compare.
* `cleaned` — whether ANY operation in the request that PRODUCED this
  artifact named this tag, derived from `CleaningOperation.tags` (omitted
  or `["*"]` means every tag) — not invented, the field already carries
  this information.
* `percentiles` — added for DS-LAKE-005B-B-T01's edit 3: a value-clip bound
  (`apps/client/lib/precleanse.ts::percentileBounds`) computed over whatever
  frame is HANDED IN. Under viewport state a client-side frame is a window,
  not the artifact, so a bound computed from it drifts with scroll/page
  position — the threshold the engineer sees is not the one the pipeline
  would apply. These are the SAME 8 percentile points the client's own
  `CLIP_PRESETS` (data-cropping-chart.tsx) already use — [1,5,10,20,80,90,
  95,99] as lo/hi pairs — computed here over the FULL population instead, so
  a future client caller reads a real bound rather than deriving a wrong one
  locally. `percentile_bounds()` uses the EXACT SAME linear-interpolation
  method as `percentileBounds` (floor/ceil positional interpolation, not
  `numpy.percentile`'s default method) so a value computed here agrees with
  what the client would have computed over the same population — this
  parity is the point, not an implementation detail.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from intergrations.object_store import STATUS_GOOD, status_column, tag_columns
from schemas.preprocess import CleaningOperation


def _good_values(frame: pd.DataFrame, tag: str) -> np.ndarray:
    values = frame[tag].to_numpy(dtype="float64", copy=False)
    statuses = frame[status_column(tag)].to_numpy(copy=False)
    return values[statuses == STATUS_GOOD]


def _outlier_count(good: np.ndarray) -> int:
    """Count of Good values outside the positional 1.5*IQR fence.

    Positional quartiles (`sorted[floor(n*q)]`), matching
    `_op_outlier_median` — `numpy.quantile` would move the fences and this
    count would then disagree with what `remove_outlier/iqr` actually flags.
    """
    n = good.size
    if n < 4:
        # Fewer than 4 points makes a quartile split not meaningful; nothing
        # is flagged rather than a fence computed from 1-3 values.
        return 0
    ordered = np.sort(good)
    q1 = float(ordered[math.floor(n * 0.25)])
    q3 = float(ordered[math.floor(n * 0.75)])
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return int(np.sum((good < lo) | (good > hi)))


#: The 8 percentile points the client's own value-clip presets need
#: (CLIP_PRESETS pairs [1,99]/[5,95]/[10,90]/[20,80] in data-cropping-chart.tsx).
#: Computed once as flat points, not as pre-paired bounds, so a future
#: preset added client-side needs no server change.
PERCENTILE_POINTS: tuple[int, ...] = (1, 5, 10, 20, 80, 90, 95, 99)


def percentile_bounds(
    good: np.ndarray, points: tuple[int, ...] = PERCENTILE_POINTS
) -> dict[str, float] | None:
    """Linear-interpolated percentiles over `good`, keyed `"p{point}"`.

    Deliberately NOT `numpy.percentile`'s default (linear-on-gaps) method —
    this is `apps/client/lib/precleanse.ts::percentileBounds`'s OWN
    floor/ceil positional interpolation, ported exactly:
    `idx = (n-1)*p/100`, interpolate between `sorted[floor(idx)]` and
    `sorted[ceil(idx)]`. They happen to agree for most inputs, but "happen to
    agree" is not a guarantee, and a value-clip bound is exactly the kind of
    number where a client and server silently disagreeing would surface as a
    threshold the engineer set not being the one the pipeline applied.
    """
    if good.size == 0:
        return None
    ordered = np.sort(good)
    n = ordered.size

    def at(p: float) -> float:
        idx = (n - 1) * p / 100
        lo = math.floor(idx)
        hi = math.ceil(idx)
        if lo == hi:
            return float(ordered[lo])
        return float(ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo))

    return {f"p{p}": round(at(p), 6) for p in points}


def _operation_applies_to_tag(operation: CleaningOperation, tag: str) -> bool:
    if operation.tags is None:
        return True
    return "*" in operation.tags or tag in operation.tags


def build_column_stats(
    frame: pd.DataFrame,
    operations: list[CleaningOperation],
    parent_frame: pd.DataFrame | None = None,
) -> dict[str, dict[str, Any]]:
    """One entry per logical tag in `frame`, keyed by tag name."""
    tags = tag_columns(frame)
    result: dict[str, dict[str, Any]] = {}

    for tag in tags:
        good = _good_values(frame, tag)
        total = int(len(frame))
        missing = int(total - good.size)
        null_pct = round(missing / total * 100, 4) if total else 0.0
        coverage = round(100.0 - null_pct, 4)
        mean = float(good.mean()) if good.size else None

        drift = None
        if parent_frame is not None and tag in tag_columns(parent_frame) and mean is not None:
            parent_good = _good_values(parent_frame, tag)
            if parent_good.size:
                drift = round(mean - float(parent_good.mean()), 6)

        result[tag] = {
            "tag": tag,
            "coverage": coverage,
            "null_pct": null_pct,
            "outlier_count": _outlier_count(good),
            "min": float(good.min()) if good.size else None,
            "max": float(good.max()) if good.size else None,
            "mean": round(mean, 6) if mean is not None else None,
            "drift": drift,
            "percentiles": percentile_bounds(good),
            "cleaned": any(
                _operation_applies_to_tag(operation, tag) for operation in operations
            ),
        }

    return result
