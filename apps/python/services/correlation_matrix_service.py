"""DS-LAKE-005B-D-T05b. Server-side Pearson correlation matrix for Step
3.1's DataAnalysisCard, over a column list RESOLVED by
`correlation_selector.select_correlation_columns` (T05a) — not the caller's
raw `tags`, and never "every tag on the artifact".

BOUNDED INPUT, UNBOUNDED OUTPUT — the direction every other endpoint in
this slice does NOT have to worry about, and named explicitly in this
task's own scope_note: 8,000 tags² is 64M matrix cells. `tags` (the
candidate universe, same REQUIRED-list convention `HistogramRequest`/
`BoxplotRequest`/`ScatterRequest` already use) bounds the INPUT; `top_k`
(hard-capped, `MAX_CORRELATION_TOP_K`) is what bounds the OUTPUT — the
response's matrix is always `len(resolved) x len(resolved)`,
`len(resolved) <= top_k`, REGARDLESS of how many tags `tags` names.

Read-only — writes no object, same guarantee every other chart service in
this router makes.

REACTIVITY: same read-a-window-then-`apply_operations` shape histogram/
boxplot/scatter already use.

RESOLUTION: delegates to `correlation_selector.select_correlation_columns`
for the near-constant filter + IQR/median-or-CV ranking (T05a) rather than
re-implementing it — this endpoint's own job is strictly "take a resolved
list, compute pairwise correlation over it, echo what was resolved and
why", per this task's own title.

PARITY: `_pearson` mirrors `lib/data-quality.ts::pearson` bug-for-bug — a
pair counts toward n only when BOTH tags are Good on the same row (same
convention `scatter_service._good_pairs` already uses, for the same
reason: a Bad cell's `0.0` MISSING_VALUE hole must never drag a
correlation toward 0), sum-of-products formula, `n < 2` returns 0,
clamped to `[-1, 1]` to absorb floating-point drift just outside that
range.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from intergrations.object_store import STATUS_GOOD, TIMESTAMP_COLUMN, ObjectStore, status_column
from schemas.preprocess import CorrelationRequest
from services.cleaning_service import apply_operations
from services.correlation_selector import select_correlation_columns


def _pearson(frame: pd.DataFrame, tag_a: str, tag_b: str) -> float:
    """Mirrors `lib/data-quality.ts::pearson` bug-for-bug."""
    a_values = frame[tag_a].to_numpy(dtype="float64", copy=False)
    b_values = frame[tag_b].to_numpy(dtype="float64", copy=False)
    a_status = frame[status_column(tag_a)].to_numpy(copy=False)
    b_status = frame[status_column(tag_b)].to_numpy(copy=False)
    mask = (a_status == STATUS_GOOD) & (b_status == STATUS_GOOD)
    x = a_values[mask]
    y = b_values[mask]

    n = x.size
    if n < 2:
        return 0.0

    sx = float(x.sum())
    sy = float(y.sum())
    sxy = float(np.dot(x, y))
    sxx = float(np.dot(x, x))
    syy = float(np.dot(y, y))

    numerator = n * sxy - sx * sy
    denominator = ((n * sxx - sx * sx) * (n * syy - sy * sy)) ** 0.5
    if denominator == 0:
        return 0.0
    r = numerator / denominator
    return max(-1.0, min(1.0, r))


def build_correlation_matrix(
    store: ObjectStore, request: CorrelationRequest
) -> dict[str, Any]:
    """Raises `ValueError` for anything the caller can fix (unknown
    column), mapped by the router to 422 — same convention as every other
    service here."""
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

    resolved, scores = select_correlation_columns(after, request.tags, request.top_k)

    insufficient = [t for t in request.tags if t not in scores]
    near_constant = [t for t in request.tags if t in scores and scores[t].near_constant]
    column_metrics = {t: scores[t].metric for t in resolved}

    k = len(resolved)
    matrix: list[list[float]] = [[0.0] * k for _ in range(k)]
    for i in range(k):
        matrix[i][i] = 1.0
        for j in range(i + 1, k):
            r = _pearson(after, resolved[i], resolved[j])
            matrix[i][j] = r
            matrix[j][i] = r

    return {
        "source_key": request.source_key,
        "tags": resolved,
        "matrix": matrix,
        "column_metrics": column_metrics,
        "insufficient_tags": insufficient,
        "near_constant_tags": near_constant,
        "total_candidates": len(request.tags),
    }
