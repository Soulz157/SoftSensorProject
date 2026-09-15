"""PSI (Population Stability Index) reference bins and bucketing —
MODEL-SERVE-001-T13. Shared between `apps/python` (fits the reference bins
at training time) and `apps/serving` (buckets live `/predict` rows against
them at inference time), for the identical reason `scaling.py`'s
`to_model_ready` is shared: training and serving must bucket a value the
SAME way, never two implementations that can silently drift apart.

`refCounts` — REAL MEASURED reference counts, never assumed uniform. A
continuous (quantile) split is equal-frequency BY CONSTRUCTION — that is
the definition of "quantile" — so assuming a uniform reference% there is
redundant, not wrong. A CATEGORICAL split (one bin per distinct trained
value, e.g. a valve's open/closed states) is NOT equal-frequency: a valve
closed 90% of the time has a real 90/10 reference split, not 50/50.
Assuming uniform there would be silently wrong for exactly the tags this
mode exists to serve — a digital/state tag. Rather than special-case one
mode, `quantile_edges` always MEASURES the reference population per bin, by
re-bucketing the train split against its own derived edges, for both modes.
PSI's expected% term is then a real count either way, never a guess.
"""

from __future__ import annotations

import bisect
from typing import Any

import numpy as np

#: Default bin count for a continuous (quantile) split. Not a hard cap —
#: `quantile_edges` reduces it (or falls back to categorical entirely) when
#: the data cannot actually support this many bins; the RESOLVED count is
#: always what gets returned and persisted, never this default silently
#: assumed by a reader (the pipelineVersion-with-a-default defect
#: DS-LAKE-022-T03 found in its own first shipped form).
DEFAULT_PSI_BIN_COUNT = 10

#: Below this many distinct Good values, a continuous quantile split is not
#: meaningful — switch to categorical mode, one bin per distinct value.
MIN_PSI_BINS = 2


def bucket_value(
    value: float, edges: list[float], bin_mode: str
) -> tuple[int | None, str | None]:
    """One value -> `(bin_index, overflow)`, exactly one of which is not
    `None`. The shared primitive: `apps/serving` buckets LIVE `/predict`
    rows with this at inference time; `bucket_histogram` below buckets the
    TRAIN split with the identical function at fit time, so a reference
    count and a live count are always produced by the same logic.

    CONTINUOUS: `edges` holds `binCount + 1` ascending boundaries; bin i
    covers `[edges[i], edges[i+1])`, except the LAST bin, which is closed on
    the right (`numpy.histogram`'s own convention). A value outside
    `[edges[0], edges[-1]]` is `overflow="below"`/`"above"` rather than
    folded into an end bin — folding would hide exactly the drift PSI
    exists to catch.

    CATEGORICAL: `edges` holds the distinct TRAINED values themselves, one
    bin per value. Matched to the NEAREST trained value rather than an
    exact match — real telemetry on a state tag can read 0.998 instead of
    exactly 1.0. No "out of range" concept in this mode (some trained value
    is always nearest), so this branch never returns an overflow.
    """
    if bin_mode == "categorical":
        nearest = min(range(len(edges)), key=lambda i: abs(edges[i] - value))
        return nearest, None

    if value < edges[0]:
        return None, "below"
    if value > edges[-1]:
        return None, "above"
    # bisect_right - 1: the bin whose LEFT edge is <= value. Clamped so a
    # value exactly equal to the last edge lands in the final bin (closed
    # on the right) rather than reading as bin `binCount` (one past the end).
    idx = bisect.bisect_right(edges, value) - 1
    idx = max(0, min(idx, len(edges) - 2))
    return idx, None


def bucket_histogram(
    values: np.ndarray, edges: list[float], bin_mode: str
) -> dict[str, Any]:
    """Bucket a full array of values against frozen `edges` —
    `{counts, below, above}`. The shared aggregation both the training-time
    reference fit (over the Good train-split population, `quantile_edges`
    below) and the serving-time live write (over one request's rows,
    `apps/serving`'s `bucket_histograms`) reduce to."""
    bin_count = len(edges) if bin_mode == "categorical" else len(edges) - 1
    counts = [0] * bin_count
    below = 0
    above = 0
    for value in values:
        idx, overflow = bucket_value(float(value), edges, bin_mode)
        if overflow == "below":
            below += 1
        elif overflow == "above":
            above += 1
        elif idx is not None:
            counts[idx] += 1
    return {"counts": counts, "below": below, "above": above}


def quantile_edges(
    good: np.ndarray, bin_count: int = DEFAULT_PSI_BIN_COUNT
) -> dict[str, Any] | None:
    """One tag's frozen PSI reference — MODEL-SERVE-001-T13's resolved
    openDecision #1 (quantile edges from the TRAIN split, per-tag, on RAW
    values, degenerate-tag rule), plus `refCounts` (module docstring).

    `good` must already be Good-only, RAW (pre-`to_model_ready`) values for
    ONE tag over the TRAIN split. Returns `None` when `good` is empty —
    nothing to bin, never a fabricated single-point edge set. Otherwise
    `{binMode, binCount, edges, refCounts}` — `refCounts[i]` is the REAL
    count of `good` values that landed in bin i (see module docstring for
    why this is measured rather than assumed).

    DEGENERATE-TAG RULE: a tag with fewer than `MIN_PSI_BINS` distinct Good
    values is not a continuous-binning candidate (a single-value tag has no
    spread to bin) — categorical mode instead. Categorical mode is also the
    fallback when quantile binning, EVEN AFTER requesting only as many bins
    as there are distinct values, still produces a bin with ZERO reference
    count: PSI's expected% term cannot be zero (`ln(actual/0)` is
    undefined), so an empty reference bin disqualifies that split rather
    than being smoothed over. Categorical mode is the guaranteed-safe floor
    for this case — built directly from `np.unique`, every bin there holds
    at least 1 count by construction. This can occasionally put a
    continuous-looking tag into categorical mode with a high bin count (a
    real but rare cost of preferring a measured, always-correct reference
    over a slightly more compressed one that might not be).
    """
    if good.size == 0:
        return None

    distinct = np.unique(good)
    if distinct.size < MIN_PSI_BINS:
        cat_edges = [float(v) for v in distinct]
        hist = bucket_histogram(good, cat_edges, "categorical")
        return {
            "binMode": "categorical",
            "binCount": int(distinct.size),
            "edges": cat_edges,
            "refCounts": hist["counts"],
        }

    # `min(bin_count, distinct.size)` rather than asserting: a tag with
    # fewer distinct values than the requested bin count cannot support
    # that many bins, and the resolved (possibly smaller) count is what
    # gets persisted and displayed — never a global default assumed at
    # read time.
    requested = min(bin_count, distinct.size)
    quantile_points = np.linspace(0.0, 1.0, requested + 1)
    raw_edges = np.quantile(good, quantile_points, method="linear")
    # Dedupe: a heavily repeated value can collapse several requested
    # quantiles onto the same boundary. Rounded before dedupe so two edges
    # that differ only in float noise collapse too, matching the 6dp
    # convention `column_stats_service`/`scalingParams` both already use.
    edges = sorted({round(float(edge), 6) for edge in raw_edges})

    if len(edges) - 1 >= MIN_PSI_BINS:
        hist = bucket_histogram(good, edges, "continuous")
        if 0 not in hist["counts"]:
            return {
                "binMode": "continuous",
                "binCount": len(edges) - 1,
                "edges": edges,
                "refCounts": hist["counts"],
            }
        # Falls through to the categorical floor below — see this
        # function's own docstring on the zero-reference-count rule.

    cat_edges = [float(v) for v in distinct]
    hist = bucket_histogram(good, cat_edges, "categorical")
    return {
        "binMode": "categorical",
        "binCount": int(distinct.size),
        "edges": cat_edges,
        "refCounts": hist["counts"],
    }
