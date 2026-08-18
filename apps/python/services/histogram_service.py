"""DS-LAKE-005B-D-T01. Server-side histogram/KDE for Step 3.1's DataAnalysisCard.

Read-only — writes no object, same guarantee `preview_service.py` makes and
`test_preview_service.py` asserts directly for that endpoint.

REACTIVITY (the reason histogram, not boxplot, was chosen as the tracer —
see this task's own `scope_note`): reuses `build_preview`'s exact window
mechanic — read a capped head window, then `apply_operations` — so the
Good-value set this function bins is the SAME post-operation state a
scrubber preview would show, not a stale `column_stats.json` snapshot. A
crop/conditional/statistical rule the user is editing live changes the
domain and the curve on the next request, by construction.

PARITY (bug-for-bug against `apps/client/lib/data-quality.ts` +
`tag-histogram-chart.tsx`, both read directly before writing this, not from
memory): shared cross-tag domain (min/max over every qualifying tag's Good
values combined, not per-tag), 50%-of-range visual padding (or `abs(max)`
when range is 0, or `1` when both are 0 — `tag-histogram-chart.tsx:134`),
Silverman's rule-of-thumb bandwidth (`h = 1.06 * std * n**(-1/5)`,
population std with ddof=1 matching `tagDistribution`'s `n - 1` divisor),
a Gaussian kernel, and `density * n * binWidth` rescaling onto a count axis
so the client plots the response with no further math. DS-LAKE-005B-D-T02
(parity fixture gate) is what proves this stays true — not asserted here.
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
)
from schemas.preprocess import HistogramRequest
from services.cleaning_service import apply_operations


def _good_values(frame: pd.DataFrame, tag: str) -> np.ndarray:
    """Mirrors `column_stats_service._good_values` — kept local rather than
    imported, since that helper is module-private by this codebase's own
    leading-underscore convention, not a shared utility."""
    values = frame[tag].to_numpy(dtype="float64", copy=False)
    statuses = frame[status_column(tag)].to_numpy(copy=False)
    return values[statuses == STATUS_GOOD]


def _tag_distribution(good: np.ndarray) -> dict[str, float]:
    """Mirrors `lib/data-quality.ts::tagDistribution` bug-for-bug — mean,
    median (average-of-two-middles on an even count), mode (longest run over
    SORTED values, ties keep the smaller value — matches the client's
    ascending-scan-keeps-first-max exactly), sample std (ddof=1)."""
    n = good.size
    sorted_vals = np.sort(good)
    mean = float(good.mean())

    mid = n // 2
    if n % 2 == 0:
        median = float((sorted_vals[mid - 1] + sorted_vals[mid]) / 2)
    else:
        median = float(sorted_vals[mid])

    mode = float(sorted_vals[0])
    best_count = 0
    run_value = sorted_vals[0]
    run_count = 0
    for v in sorted_vals:
        if v == run_value:
            run_count += 1
        else:
            run_value = v
            run_count = 1
        if run_count > best_count:
            best_count = run_count
            mode = float(v)

    std = float(good.std(ddof=1)) if n >= 2 else 0.0
    vmin = float(sorted_vals[0])
    vmax = float(sorted_vals[-1])
    return {
        "mean": mean,
        "median": median,
        "mode": mode,
        "std": std,
        "min": vmin,
        "max": vmax,
        "range": vmax - vmin,
    }


def _kde_estimate(
    values: np.ndarray, domain_min: float, domain_max: float, sample_count: int
) -> list[tuple[float, float]]:
    """Mirrors `lib/data-quality.ts::kdeEstimate` bug-for-bug."""
    n = values.size
    if n < 2 or domain_max <= domain_min:
        return []
    std = float(values.std(ddof=1))
    if std == 0:
        return []
    h = 1.06 * std * (n ** (-1 / 5))
    if h <= 0:
        return []

    step = (domain_max - domain_min) / (sample_count - 1)
    points: list[tuple[float, float]] = []
    for k in range(sample_count):
        x = domain_min + k * step
        u = (x - values) / h
        density = float(np.sum(np.exp(-(u * u) / 2) / math.sqrt(2 * math.pi)))
        points.append((x, density / (n * h)))
    return points


def build_histogram(store: ObjectStore, request: HistogramRequest) -> dict[str, Any]:
    """Same read-a-window-then-apply-operations shape as `build_preview`,
    scoped to exactly the tags this request asks for (never "every tag" —
    `HistogramRequest.tags` is required, unlike `PreviewRequest.tags`).

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

    good_by_tag: dict[str, np.ndarray] = {}
    for tag in request.tags:
        good_by_tag[tag] = _good_values(after, tag)

    qualifying = [t for t in request.tags if good_by_tag[t].size >= 2]
    insufficient = [t for t in request.tags if t not in qualifying]

    if not qualifying:
        return {
            "source_key": request.source_key,
            "domain_min": None,
            "domain_max": None,
            "tags": [],
            "insufficient_tags": insufficient,
        }

    all_qualifying_values = np.concatenate([good_by_tag[t] for t in qualifying])
    domain_min = float(all_qualifying_values.min())
    domain_max = float(all_qualifying_values.max())
    bin_width = (domain_max - domain_min) / request.bin_count if request.bin_count else 0

    rng = domain_max - domain_min
    pad = (rng if rng else (abs(domain_max) if domain_max else 1.0)) * 0.5
    padded_min = domain_min - pad
    padded_max = domain_max + pad

    tags_out = []
    for tag in qualifying:
        values = good_by_tag[tag]
        dist = _tag_distribution(values)
        kde_points = _kde_estimate(values, padded_min, padded_max, request.kde_samples)
        kde_out = [
            {"x": x, "y": density * values.size * bin_width} for x, density in kde_points
        ]
        tags_out.append(
            {
                "tag": tag,
                **dist,
                "count": int(values.size),
                "kde": kde_out,
            }
        )

    return {
        "source_key": request.source_key,
        "domain_min": domain_min,
        "domain_max": domain_max,
        "tags": tags_out,
        "insufficient_tags": insufficient,
    }
