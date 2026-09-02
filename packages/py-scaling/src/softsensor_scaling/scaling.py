"""`toModelReady`. Moved verbatim from
`apps/python/services/feature_service.py:79-560` (the scaling half only —
`apply_features`/`select_columns` and the feature-engineering ops stay in
`apps/python`, since serving never applies them; see MODEL-SERVE-002's
"Contract boundary" — /predict receives the model's feature columns
already engineered, pre-scaling). `feature_service.py` re-exports these
same names so every existing caller in that module is unchanged.

Quirks that are load-bearing, each covered by a DS-LAKE-006-T01 fixture
(preserved from the original docstring — the fixtures did not move, but the
behaviour they pin did):

* **`toModelReady` scales every FINITE value regardless of its ORIGINAL
  status** and always emits Good afterward — a Bad cell holding a real
  (non-hole) number is silently laundered to Good by scaling.
* **`standard`'s std is POPULATION std (`/n`) via Welford's online
  algorithm, in ROW ORDER** — not `numpy`'s vectorized reduction, which can
  differ in the last few ULPs for the same mathematical quantity.
* **`robust`'s median/IQR are Tukey's exclusive hinges** over SORTED FINITE
  values, not `numpy.percentile`'s interpolated quartiles.
* **`robust` scaling skips a tag ENTIRELY if it has zero finite values** —
  unlike `minmax`/`standard`, which still force every cell to `(0, Good)`
  in that case. The column is left byte-identical to its input.
* **Every scaled value rounds to 3 decimals UNCONDITIONALLY**, via
  `_round_to` (JS `Math.round` half-up, not Python's banker's rounding).
"""

from __future__ import annotations

import math
from typing import Mapping

import numpy as np
import pandas as pd

from .constants import STATUS_GOOD, status_column
from .rounding import _median_sorted, _round_to

DEFAULT_SCALER = "minmax"


class FeatureError(ValueError):
    """Invalid feature config or scaler, safe to surface to the caller."""


def _welford_population_std(values: list[float]) -> tuple[float, float]:
    """Mean and POPULATION std (`/n`) via Welford's online algorithm.

    Iterates `values` in the order given — callers MUST pass row order, not
    a numpy-vectorised reduction, so float results match `toModelReady`'s
    own row-by-row accumulation bit-for-bit rather than merely numerically.
    """
    n = 0
    mean = 0.0
    m2 = 0.0
    for v in values:
        n += 1
        d = v - mean
        mean += d / n
        m2 += d * (v - mean)
    std = math.sqrt(m2 / n) if n > 0 else 0.0
    return mean, std


def _scale_column(
    values: np.ndarray,
    method: str,
    params: Mapping[str, float] | None = None,
) -> tuple[np.ndarray, dict[str, float]]:
    """Transform one tag's dense values array (`scaleColumn`/`toModelReady` body).

    Every branch here already ran once for its own float; a caller that
    determines the whole column should be left untouched (the `robust`,
    zero-finite-values case) must check for that itself and skip calling
    this at all — this function unconditionally returns a transformed array.

    DS-LAKE-018-T02: also returns the params the transform actually used, so
    a caller (`to_model_ready`) can persist what was FIT (`feature_spec.json`
    `scalingParams`) or, when `params` is given here, apply what was
    RECORDED instead of re-fitting — the replay path DS-LAKE-018-T04 needs
    for a holdout (and what MODEL-SERVE-002's serving loader needs at
    predict time), which must be scaled with the train rows' own
    statistics, never its own.
    """
    finite_mask = np.isfinite(values)

    if method == "none":
        return np.array([_round_to(v, 3) for v in values]), {}

    if method == "minmax":
        if params is not None:
            lo, hi = params["min"], params["max"]
        else:
            finite = values[finite_mask]
            if finite.size == 0:
                lo, hi = 0.0, 0.0
            else:
                lo = float(finite.min())
                hi = float(finite.max())
        span = hi - lo
        scaled = np.array(
            [0.0 if span == 0 else _round_to((v - lo) / span, 3) for v in values]
        )
        return scaled, {"min": lo, "max": hi}

    if method == "standard":
        if params is not None:
            mean, std = params["mean"], params["std"]
        else:
            # Row order matters — see _welford_population_std's own docstring.
            finite_in_order = [float(v) for v in values if np.isfinite(v)]
            mean, std = _welford_population_std(finite_in_order)
        scaled = np.array(
            [0.0 if std == 0 else _round_to((v - mean) / std, 3) for v in values]
        )
        return scaled, {"mean": mean, "std": std}

    if method == "robust":
        if params is not None:
            med, iqr = params["median"], params["iqr"]
        else:
            finite_sorted = sorted(float(v) for v in values if np.isfinite(v))
            k = len(finite_sorted)
            if k == 0:
                # Fitting on zero finite values: nothing to compute — caller
                # skips this tag entirely rather than force (0, Good).
                return values.copy(), {}
            med = _median_sorted(finite_sorted)
            upper = _median_sorted(finite_sorted[math.ceil(k / 2):])
            lower = _median_sorted(finite_sorted[: math.floor(k / 2)])
            iqr = upper - lower
        scaled = np.array(
            [0.0 if iqr == 0 else _round_to((v - med) / iqr, 3) for v in values]
        )
        return scaled, {"median": med, "iqr": iqr}

    raise FeatureError(f"Unknown scaler {method!r}")


def to_model_ready(
    df: pd.DataFrame,
    tags: list[str],
    scalers: Mapping[str, str],
    fitted_params: Mapping[str, Mapping[str, float]] | None = None,
) -> tuple[pd.DataFrame, dict[str, dict[str, float]]]:
    """Scale every tag column and force its status to Good (`toModelReady`).

    Every FINITE value is scaled regardless of its ORIGINAL status — a Bad
    cell holding a real number is scaled and marked Good, same as the
    browser. `robust` is the one exception: a tag with zero finite values is
    left byte-identical (values AND status), matching the TS `if (k === 0)
    continue` that skips before the status-forcing loop even runs.

    DS-LAKE-018-T02: returns `(frame, scaling_params)` — `scaling_params` is
    what each tag's scaler actually FIT (or, when `fitted_params` supplies a
    tag, what it was given instead of re-fitting — DS-LAKE-018-T04's holdout
    replay, and MODEL-SERVE-002's serving predict). Only tags with real fit
    state are keys; "none"-scaled and entirely-skipped (`robust`, zero
    finite values) tags are absent, same "no comparison possible" convention
    `build_column_stats` already uses elsewhere for a tag that has nothing
    to report.
    """
    out = df.copy()
    scaling_params: dict[str, dict[str, float]] = {}
    for tag in tags:
        if tag not in out.columns:
            continue
        method = scalers.get(tag, DEFAULT_SCALER)
        values = out[tag].to_numpy(dtype="float64")

        if method == "robust" and not np.isfinite(values).any():
            continue  # column left exactly as-is, status untouched

        params = fitted_params.get(tag) if fitted_params else None
        scaled, used_params = _scale_column(values, method, params)
        out[tag] = scaled
        out[status_column(tag)] = pd.array(
            np.full(len(out), STATUS_GOOD, dtype="int8"), dtype="int8"
        )
        if used_params:
            scaling_params[tag] = used_params
    return out, scaling_params


def assert_scaling_coverage(
    tags: list[str],
    scalers: Mapping[str, str],
    scaling_params: Mapping[str, Mapping[str, float]],
) -> None:
    """Refuse to scale a tag whose fitted params were not recorded.

    Lifted from the guard `services/artifact_service.py:680-691` already
    applies inside `prepare_holdout_for_run`, generalised so both that
    caller and MODEL-SERVE-002's serving loader share ONE refusal instead
    of two copies that could disagree about which tags need coverage.

    A tag resolves to `DEFAULT_SCALER` when absent from `scalers` — same
    lookup `to_model_ready` itself uses (`scalers.get(tag, DEFAULT_SCALER)`)
    — so an unrecorded default-scaled tag is refused exactly like an
    unrecorded explicitly-scaled one. This is the guard against the
    empty-`scaling`-array trap: `feature_spec.json`'s `scaling` list holds
    an entry ONLY for a tag with an EXPLICIT scaler choice, so checking
    `scaling` for non-emptiness to decide "was anything scaled?" is wrong on
    every real spec in this system (all have `scaling: []` while
    `scalingParams` is fully populated) — this function checks
    `scaling_params` coverage per tag instead, never `scaling`'s emptiness.
    """
    unrecorded = [
        tag
        for tag in tags
        if scalers.get(tag, DEFAULT_SCALER) != "none" and tag not in scaling_params
    ]
    if unrecorded:
        raise ValueError(
            f"Scaling refused: {sorted(unrecorded)} would scale without a "
            "recorded scalingParams entry, which would silently re-fit on "
            "this frame's own statistics instead of the train's."
        )
