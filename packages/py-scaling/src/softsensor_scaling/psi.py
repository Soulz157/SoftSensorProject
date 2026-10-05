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
    exactly 1.0. MODEL-SERVE-029: a value further than half the smallest
    gap between adjacent trained values PAST EITHER END is overflow — a
    state the tag never held in training (a valve trained on {0, 1} now
    reading 2) must not be silently counted as its nearest neighbour. A
    single-value tag has no gap, so its tolerance is 0: anything other than
    the trained value itself is overflow (otherwise its PSI is 0 forever).
    An unseen value BETWEEN two trained values is still matched to the
    nearest one — this mode has no notion of "between states".
    """
    if bin_mode == "categorical":
        tolerance = (
            min(b - a for a, b in zip(edges, edges[1:])) / 2
            if len(edges) >= 2
            else 0.0
        )
        if value < edges[0] - tolerance:
            return None, "below"
        if value > edges[-1] + tolerance:
            return None, "above"
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
    than being smoothed over.

    DISTINCT-VALUE FALLBACK (MODEL-SERVE-029): when that quantile split
    fails on a CONTINUOUS-LOOKING tag (more distinct values than
    `bin_count` — typically a heavy point mass plus a long tail, which
    collapses most quantiles onto one edge), the edges are taken from the
    sorted distinct values instead, evenly spaced by rank. Every such bin
    starts at a real observed value, so none is empty, and the bin count
    stays at most `bin_count`. Falling straight to categorical there gave
    one bin per distinct value — thousands for a real sensor — and a
    sample floor (`binCount * PSI_MIN_SAMPLES_PER_BIN`) live traffic could
    never clear. Categorical mode is therefore reached only with at most
    `bin_count` distinct values, and stays the guaranteed-safe floor —
    built directly from `np.unique`, every bin there holds at least 1
    count by construction.
    """
    if good.size == 0:
        return None

    distinct = np.unique(good)
    if distinct.size < MIN_PSI_BINS:
        return _categorical(good, distinct)

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
    fitted = _continuous(good, edges)
    if fitted is not None:
        return fitted

    if distinct.size > bin_count:
        ranks = np.linspace(
            0, distinct.size - 1, min(bin_count, distinct.size - 1) + 1
        )
        rank_edges = sorted({float(distinct[int(round(r))]) for r in ranks})
        fitted = _continuous(good, rank_edges)
        if fitted is not None:
            return fitted

    return _categorical(good, distinct)


def _continuous(good: np.ndarray, edges: list[float]) -> dict[str, Any] | None:
    """A continuous reference over `edges`, or `None` when the split is
    unusable (fewer than `MIN_PSI_BINS` bins, or an empty reference bin).

    The outer edges are widened to the train min/max first (MODEL-SERVE-029):
    rounding to 6dp can move `edges[0]` just ABOVE the smallest training
    value (1.2345678 -> 1.234568) or `edges[-1]` just BELOW the largest,
    and that value would then be counted as overflow against its own
    reference and left out of `refCounts`. After widening, every training
    value lies inside its own edges, so `sum(refCounts) == good.size`."""
    if len(edges) - 1 < MIN_PSI_BINS:
        return None
    edges = list(edges)
    edges[0] = min(edges[0], float(good.min()))
    edges[-1] = max(edges[-1], float(good.max()))
    hist = bucket_histogram(good, edges, "continuous")
    if 0 in hist["counts"]:
        return None
    return {
        "binMode": "continuous",
        "binCount": len(edges) - 1,
        "edges": edges,
        "refCounts": hist["counts"],
    }


def _categorical(good: np.ndarray, distinct: np.ndarray) -> dict[str, Any]:
    cat_edges = [float(v) for v in distinct]
    hist = bucket_histogram(good, cat_edges, "categorical")
    return {
        "binMode": "categorical",
        "binCount": int(distinct.size),
        "edges": cat_edges,
        "refCounts": hist["counts"],
    }
