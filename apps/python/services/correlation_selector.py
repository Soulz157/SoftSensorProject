"""DS-LAKE-005B-D-T05a. Server-side correlation column selector: filters
near-constant tags, then ranks the remainder by a variability metric, for
DS-LAKE-005B-D-T05b's correlation matrix to consume as its RESOLVED column
list (T05b's own scope_note: "Takes a resolved column list as input, never
'all tags'").

METRIC DECISION (openDecisions, user-confirmed 2026-08-16 via
AskUserQuestion — the fork this task's own scope_note required be answered
"first, not guessed"): IQR/median ratio as primary; CV (sigma/|mu|) as
fallback when the median is too close to 0 for IQR/median to be numerically
stable. A near-constant filter runs FIRST, before ranking, so a flatlined
tag can never enter top-k regardless of its ratio.

Rejected as literally written ("top-k by variance", the openDecisions
finding): raw variance is scale-dependent — kg/h and kPa tags would
dominate unconditionally while valve-position/fraction tags could never
rank regardless of how interesting their correlations are — and
normalising first makes variance a no-op (a z-scored series always has
variance 1, erasing the ranking entirely).

KNOWN LIMITATION, not silently smoothed over: a tag oscillating around a
near-zero MEAN (e.g. a control-error signal, ±5 around 0) with genuine
variability will have both median≈0 AND mean≈0, so it falls through both
the IQR/median and CV branches and is classified near-constant even though
it isn't. This is the doubly-degenerate case the approved decision didn't
address (only "CV as fallback when median is near 0" was decided); fixing
it would mean inventing a third, unapproved branch (e.g. ranking by raw
|IQR| when both center estimates are near 0), so it is left as a named gap
rather than smuggled in.

Deliberately NOT `column_stats_service.percentile_bounds()` — that
function's DEFAULT `PERCENTILE_POINTS` (1,5,10,20,80,90,95,99) does not
include p25/p50/p75, and widening the shared default would change
`column_stats.json`'s and preview's already-shipped percentile contract
for two unrelated features (checked directly:
`test_percentile_bounds_covers_every_clip_preset_point` asserts the exact
8-key set — widening it would break that test and every existing
consumer's payload shape). Small local quantile function instead, same
linear-interpolation convention `boxplot_service._quantile` and
`column_stats_service.percentile_bounds` both already use — this
codebase's own established precedent (leading-underscore, module-private,
NOT a shared utility — `histogram_service`/`boxplot_service` duplicate
`_good_values` for the identical reason) for exactly this situation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from intergrations.object_store import STATUS_GOOD, status_column

#: Below this |median|, IQR/median is numerically unstable (near-zero
#: denominator) — fall back to CV instead of a ratio that blows up or
#: flips sign on noise alone.
NEAR_ZERO_CENTER_THRESHOLD = 1e-9
#: A tag whose score (IQR/|median|, or CV when the median fallback fires)
#: is at or below this is near-constant and excluded before ranking — a
#: starting heuristic, not a proven-optimal constant; tunable if real plant
#: data shows it too strict or too lenient.
NEAR_CONSTANT_SCORE_THRESHOLD = 1e-6


@dataclass(frozen=True)
class ColumnScore:
    tag: str
    #: Which branch produced `score` — "iqr_median" or "cv". T05b's
    #: acceptance criteria requires the response "states the ranking
    #: metric used"; this is what it echoes.
    metric: str
    score: float
    near_constant: bool


def _quantile(sorted_vals: np.ndarray, p: float) -> float:
    """Same linear-interpolation convention as `boxplot_service._quantile`
    / `lib/data-quality.ts::quantile` — `idx = p*(n-1)`, floor/ceil blend.
    `p` is in [0, 1], unlike `column_stats_service.percentile_bounds`'s
    0-100 scale."""
    n = sorted_vals.size
    if n == 1:
        return float(sorted_vals[0])
    idx = p * (n - 1)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    lo_val = float(sorted_vals[lo])
    hi_val = float(sorted_vals[hi])
    return lo_val + (hi_val - lo_val) * (idx - lo)


def _good_values(frame: pd.DataFrame, tag: str) -> np.ndarray:
    """Mirrors `histogram_service._good_values`/`boxplot_service._good_values`
    — kept local per this module's own leading-underscore convention."""
    values = frame[tag].to_numpy(dtype="float64", copy=False)
    statuses = frame[status_column(tag)].to_numpy(copy=False)
    return values[statuses == STATUS_GOOD]


def score_column(good: np.ndarray) -> ColumnScore | None:
    """Scores one tag's Good values. Returns `None` for fewer than 2 Good
    values — nothing meaningful to rank (same `>= 2` bar
    `histogram_service.build_histogram` uses for a distribution to qualify).
    `tag` is left empty on the returned `ColumnScore`; the caller fills it
    in (`select_correlation_columns` below) — kept separable so this
    function stays testable against a bare array, no frame required.
    """
    if good.size < 2:
        return None

    sorted_vals = np.sort(good)
    median = _quantile(sorted_vals, 0.5)
    q1 = _quantile(sorted_vals, 0.25)
    q3 = _quantile(sorted_vals, 0.75)
    iqr = q3 - q1

    if abs(median) > NEAR_ZERO_CENTER_THRESHOLD:
        score = iqr / abs(median)
        metric = "iqr_median"
    else:
        mean = float(good.mean())
        if abs(mean) <= NEAR_ZERO_CENTER_THRESHOLD:
            # Doubly-degenerate: median AND mean both ~0. See this module's
            # own "KNOWN LIMITATION" docstring — classified near-constant
            # rather than inventing an unapproved third branch.
            return ColumnScore(tag="", metric="cv", score=0.0, near_constant=True)
        std = float(good.std(ddof=1))
        score = std / abs(mean)
        metric = "cv"

    return ColumnScore(
        tag="",
        metric=metric,
        score=score,
        near_constant=score <= NEAR_CONSTANT_SCORE_THRESHOLD,
    )


def select_correlation_columns(
    frame: pd.DataFrame, tags: list[str], top_k: int
) -> tuple[list[str], dict[str, ColumnScore]]:
    """Filters near-constant tags out of `tags`, ranks the remainder by
    score descending (higher IQR/median or CV = more variability = more
    potentially-interesting correlation structure), returns at most
    `top_k` tag names.

    Also returns every SCORED tag's `ColumnScore` (near-constant ones
    included) — a caller building T05b's response can use it to state the
    metric per tag and to distinguish "excluded: near-constant" from
    "excluded: fewer than 2 Good values" without re-scoring.

    `tags` is caller-supplied — this function does not itself decide "every
    tag on the artifact"; T05b's own scope_note requires the correlation
    matrix take a resolved list, never an unbounded "all tags" default, and
    the same discipline applies to what THIS function is asked to score.
    """
    scores: dict[str, ColumnScore] = {}
    for tag in tags:
        good = _good_values(frame, tag)
        scored = score_column(good)
        if scored is None:
            continue
        scores[tag] = ColumnScore(
            tag=tag,
            metric=scored.metric,
            score=scored.score,
            near_constant=scored.near_constant,
        )

    qualifying = [t for t, s in scores.items() if not s.near_constant]
    ranked = sorted(qualifying, key=lambda t: scores[t].score, reverse=True)
    return ranked[:top_k], scores
