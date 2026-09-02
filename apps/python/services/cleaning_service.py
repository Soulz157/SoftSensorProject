"""Data-cleaning operations, ported to match the browser bug-for-bug.

The browser has been the only implementation of this pipeline
(`apps/client/lib/preprocessing.ts`). Datasets already saved were produced by
it, so this port reproduces its behaviour exactly — quirks included — and
`packages/parity-fixtures` proves it. Normalising the quirks is a separate,
deliberate change; doing it here would make every numeric diff ambiguous.

Quirks that are load-bearing, each covered by a fixture:

* **JS rounding, not Python's.** `Math.round` is round-half-up
  (`Math.round(2.5) === 3`, `Math.round(-2.5) === -2`); Python's `round` is
  banker's rounding (`round(2.5) == 2`). See `_round_to`.
* **Two std conventions coexist.** `zscore` here uses POPULATION std (`/n`),
  while `precleanse.tagStats` uses SAMPLE std (`/(n-1)`). Both are preserved.
* **Quartiles use a floor index**, `sorted[floor(n * 0.25)]`, with no
  interpolation — `numpy.quantile` would move the fences.
* **`zscore` replaces outliers with the mean**; it does not remove them.
* **Fills do not round**; the outlier and smoothing ops do.
* **Forward/backward fill flips status to Good even with no donor cell**, so
  the value stays put but stops counting as missing.
* **`drop` marks rows across every tag and removes the union once at the end.**

One emergent behaviour worth knowing about
------------------------------------------
`zscore` computes mean/std from Good cells only but applies the test to EVERY
cell, exactly as the browser does. Combined with `frame_service.MISSING_VALUE`
(holes are stored as `0.0`, Bad), a hole sitting among readings around 72 is a
huge z-score, so `zscore` replaces it with the mean and marks it Good — i.e. it
imputes. The browser never saw this because its Bad cells hold plausible
values, not zeros. It is arguably desirable, but it is a real interaction
between two independently correct decisions, so it is pinned by
`test_zscore_imputes_a_bad_hole` rather than left to be rediscovered.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    status_column,
    tag_columns,
)
from softsensor_scaling import _js_round, _median_sorted, _round_to

# MODEL-SERVE-002 decisions.serving_transform_is_an_extracted_module —
# _js_round/_round_to/_median_sorted moved to softsensor_scaling (imported
# above), since `to_model_ready`'s scaling depends on them too and serving
# must not import this module (it pulls object_store -> config.settings,
# requiring SYS_USER/SYS_PASS/PI_NAME at import time). Re-imported here
# under their original names so every existing call in this file below is
# unchanged.

DEFAULT_PRECISION = 2
DEFAULT_SMOOTH_WINDOW = 3
DEFAULT_ZSCORE_THRESHOLD = 3.0
DEFAULT_EMA_ALPHA = 0.3


class CleaningError(ValueError):
    """Invalid operation or parameter, safe to surface to the caller."""


def _good_values(values: np.ndarray, statuses: np.ndarray) -> np.ndarray:
    return values[statuses == STATUS_GOOD]


def _number(raw: Any, fallback: float) -> float:
    if raw is None:
        return fallback
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return fallback
    return fallback if math.isnan(value) else value


# ── individual operations ────────────────────────────────────────────────
#
# Each mutates `values`/`statuses` in place for one tag. `drop_rows` collects
# POSITIONAL row indices, removed once every tag has been processed.


def _op_drop(values, statuses, step, precision, drop_rows) -> None:
    for i in range(len(statuses)):
        if statuses[i] != STATUS_GOOD:
            drop_rows.add(i)


def _op_interpolate(values, statuses, step, precision, drop_rows) -> None:
    """Linear interpolation between the nearest Good neighbours.

    With one neighbour the value is carried from it; with none it is left
    alone. Either way the cell becomes Good, matching `interpolateTag`.
    """
    n = len(values)
    for i in range(n):
        if statuses[i] == STATUS_GOOD:
            continue

        p = i - 1
        while p >= 0 and statuses[p] != STATUS_GOOD:
            p -= 1
        nx = i + 1
        while nx < n and statuses[nx] != STATUS_GOOD:
            nx += 1

        has_prev = p >= 0
        has_next = nx < n
        if has_prev and has_next:
            ratio = (i - p) / (nx - p)
            values[i] = values[p] + (values[nx] - values[p]) * ratio
        elif has_prev:
            values[i] = values[p]
        elif has_next:
            values[i] = values[nx]
        statuses[i] = STATUS_GOOD


def _fill(values, statuses, strategy: str, constant: Any) -> None:
    """Shared imputation primitive (`applyFillStrategy`).

    Deliberately does NOT round — the chosen fill value stands as-is.
    """
    good = _good_values(values, statuses)

    fill_value: float | None = None
    if strategy == "mean" and good.size > 0:
        fill_value = float(good.sum() / good.size)
    elif strategy == "median" and good.size > 0:
        ordered = np.sort(good)
        mid = ordered.size // 2
        fill_value = (
            float((ordered[mid - 1] + ordered[mid]) / 2)
            if ordered.size % 2 == 0
            else float(ordered[mid])
        )
    elif strategy == "constant":
        fill_value = 0.0 if constant is None else float(constant)

    n = len(values)
    for i in range(n):
        if statuses[i] == STATUS_GOOD:
            continue

        if strategy == "forward":
            p = i - 1
            while p >= 0 and statuses[p] != STATUS_GOOD:
                p -= 1
            if p >= 0:
                values[i] = values[p]
        elif strategy == "backward":
            nx = i + 1
            while nx < n and statuses[nx] != STATUS_GOOD:
                nx += 1
            if nx < n:
                values[i] = values[nx]
        elif fill_value is not None:
            values[i] = fill_value

        # Always Good, even when no donor existed. The browser does this, and
        # it is what stops the cell being removed by a later `drop` step.
        statuses[i] = STATUS_GOOD


def _op_zscore(values, statuses, step, precision, drop_rows) -> None:
    """Replace outliers with the MEAN — this op removes nothing."""
    threshold = _number(step.get("param"), DEFAULT_ZSCORE_THRESHOLD)
    good = _good_values(values, statuses)

    mean = float(good.sum() / good.size) if good.size else 0.0
    if good.size:
        # POPULATION variance (/n). precleanse.tagStats uses /(n-1); the two
        # conventions genuinely differ and both are intentional.
        variance = float(((good - mean) ** 2).sum() / good.size)
    else:
        variance = 0.0
    std = math.sqrt(variance)
    if std == 0:
        return

    rounded_mean = _round_to(mean, precision)
    for i in range(len(values)):
        if abs((values[i] - mean) / std) > threshold:
            values[i] = rounded_mean
            statuses[i] = STATUS_GOOD


def _op_clip(values, statuses, step, precision, drop_rows) -> None:
    """Winsorise to [paramLow, param]. No rounding, no status change."""
    low = step.get("paramLow")
    high = step.get("param")
    for i in range(len(values)):
        if low is not None and values[i] < low:
            values[i] = float(low)
        if high is not None and values[i] > high:
            values[i] = float(high)


def _op_crop(values, statuses, step, precision, drop_rows) -> None:
    """Keep the [paramLow, param] band; DROP the rows outside it.

    Row-level like `drop`, so the union across tags is removed once at the end
    — cropping one tag trims that timestamp for the others too.

    A no-op while neither bound is set: an unbounded crop would drop every
    row, so adding the step before typing a bound must change nothing. Mirrors
    `applyCleaningStep`'s `crop` branch exactly.
    """
    low = step.get("paramLow")
    high = step.get("param")
    if low is None and high is None:
        return
    for i in range(len(values)):
        outside = (low is not None and values[i] < low) or (
            high is not None and values[i] > high
        )
        if outside:
            drop_rows.add(i)


def _op_exclude(values, statuses, step, precision, drop_rows) -> None:
    """Mark everything INSIDE [paramLow, param] Bad — the inverse of `crop`.

    Bad rather than dropped: null-equivalent, so a later fill step in the same
    pipeline can impute it, and only THIS tag is affected. No rounding, values
    untouched. Same both-bounds-unset no-op guard as `crop`.
    """
    low = step.get("paramLow")
    high = step.get("param")
    if low is None and high is None:
        return
    for i in range(len(values)):
        inside = (low is None or values[i] >= low) and (
            high is None or values[i] <= high
        )
        if inside:
            statuses[i] = STATUS_BAD


def _op_outlier_median(values, statuses, step, precision, drop_rows) -> None:
    """IQR fence, replacing outliers with the median. Status untouched.

    Quartiles are positional (`sorted[floor(n * q)]`) with no interpolation, so
    `numpy.quantile` must not be substituted — it would move the fences.
    Unlike zscore this considers EVERY cell, not only the Good ones.
    """
    n = len(values)
    if n == 0:
        return

    ordered = np.sort(values)
    q1 = float(ordered[math.floor(n * 0.25)])
    q3 = float(ordered[math.floor(n * 0.75)])
    iqr = q3 - q1
    med = _median_sorted(ordered.tolist())
    lo = q1 - 1.5 * iqr
    hi = q3 + 1.5 * iqr

    rounded_med = _round_to(med, precision)
    for i in range(n):
        if values[i] < lo or values[i] > hi:
            values[i] = rounded_med


def _op_moving_avg(values, statuses, step, precision, drop_rows) -> None:
    """Centred moving average whose window SHRINKS at the edges.

    pandas `.rolling(window, center=True)` emits NaN at the boundaries instead
    of averaging the shorter span, so this is written out explicitly.
    """
    window = max(1, int(_js_round(_number(step.get("param"), DEFAULT_SMOOTH_WINDOW))))
    half = window // 2
    original = values.copy()
    n = len(values)

    for i in range(n):
        lo = max(0, i - half)
        hi = min(n - 1, i + half)
        total = float(original[lo : hi + 1].sum())
        values[i] = _round_to(total / (hi - lo + 1), precision)


def _op_exponential(values, statuses, step, precision, drop_rows) -> None:
    """EMA seeded with the first value (`adjust=False`), alpha clamped to 0..1."""
    alpha = min(1.0, max(0.0, _number(step.get("param"), DEFAULT_EMA_ALPHA)))
    ema: float | None = None
    for i in range(len(values)):
        ema = values[i] if ema is None else alpha * values[i] + (1 - alpha) * ema
        values[i] = _round_to(ema, precision)


def _op_fill_factory(strategy: str) -> Callable:
    def _apply(values, statuses, step, precision, drop_rows) -> None:
        _fill(values, statuses, strategy, step.get("param"))

    return _apply


# ── registry ─────────────────────────────────────────────────────────────
#
# Keys are the browser's `CleaningMethod` values, so a saved recipe replays
# without translation.

CLEANING_OPS: dict[str, Callable] = {
    # missing
    "drop": _op_drop,
    "interpolate": _op_interpolate,
    "mean": _op_fill_factory("mean"),
    "median": _op_fill_factory("median"),
    "constant": _op_fill_factory("constant"),
    "forward": _op_fill_factory("forward"),
    "backward": _op_fill_factory("backward"),
    # outliers
    "zscore": _op_zscore,
    "clip": _op_clip,
    "crop": _op_crop,
    "exclude": _op_exclude,
    "outlier_median": _op_outlier_median,
    # smoothing
    "moving_avg": _op_moving_avg,
    "exponential": _op_exponential,
}

# Request-level operation names (the public API shape) mapped onto the
# browser's method names above.
OPERATION_ALIASES: dict[tuple[str, str | None], str] = {
    ("drop_missing", None): "drop",
    ("fill_missing", "ffill"): "forward",
    ("fill_missing", "bfill"): "backward",
    ("fill_missing", "forward"): "forward",
    ("fill_missing", "backward"): "backward",
    ("fill_missing", "mean"): "mean",
    ("fill_missing", "median"): "median",
    ("fill_missing", "constant"): "constant",
    ("fill_missing", "linear"): "interpolate",
    ("remove_outlier", "zscore"): "zscore",
    ("remove_outlier", "iqr"): "outlier_median",
    ("clip", None): "clip",
    ("smooth", "moving_avg"): "moving_avg",
    ("smooth", "exponential"): "exponential",
}


def resolve_method(op_type: str, method: str | None) -> str:
    """Map a request operation onto a registry key, or fail loudly."""
    if op_type in CLEANING_OPS and method is None:
        return op_type

    key = OPERATION_ALIASES.get((op_type, method))
    if key is None:
        key = OPERATION_ALIASES.get((op_type, None))
    if key is None:
        supported = sorted({t for t, _ in OPERATION_ALIASES})
        raise CleaningError(
            f"Unsupported operation {op_type!r}"
            + (f" with method {method!r}" if method else "")
            + f". Supported operations: {supported}."
        )
    return key


# ── engine ───────────────────────────────────────────────────────────────


def preprocess_pipelines(
    frame: pd.DataFrame,
    pipelines: Mapping[str, Sequence[Mapping[str, Any]]],
    precision: Mapping[str, int] | None = None,
) -> pd.DataFrame:
    """Run ordered per-tag cleaning steps (`preprocessPipelines`).

    Steps execute in the order listed. `drop` steps mark row indices across
    every tag and the union is removed ONCE at the end, so a drop on one tag
    removes that whole row for the others too. Tags with no pipeline pass
    through untouched.
    """
    precision = precision or {}
    tags = tag_columns(frame)
    out = frame.copy()

    columns: dict[str, np.ndarray] = {}
    statuses: dict[str, np.ndarray] = {}
    for tag in tags:
        columns[tag] = out[tag].to_numpy(dtype="float64", copy=True)
        statuses[tag] = out[status_column(tag)].to_numpy(dtype="int8", copy=True)

    drop_rows: set[int] = set()

    for tag in tags:
        steps = pipelines.get(tag)
        if not steps:
            continue
        tag_precision = int(precision.get(tag, DEFAULT_PRECISION))

        for step in steps:
            method = step.get("method")
            if method not in CLEANING_OPS:
                raise CleaningError(
                    f"Unknown cleaning method {method!r} for tag {tag!r}. "
                    f"Supported: {sorted(CLEANING_OPS)}."
                )
            CLEANING_OPS[method](
                columns[tag], statuses[tag], step, tag_precision, drop_rows
            )

    for tag in tags:
        out[tag] = columns[tag]
        out[status_column(tag)] = pd.array(statuses[tag], dtype="int8")

    if drop_rows:
        keep = [i for i in range(len(out)) if i not in drop_rows]
        out = out.iloc[keep].reset_index(drop=True)

    return out


def apply_operations(
    frame: pd.DataFrame,
    operations: Iterable[Mapping[str, Any]],
    precision: Mapping[str, int] | None = None,
) -> pd.DataFrame:
    """Apply request-shaped operations, e.g.

        [{"type": "fill_missing", "method": "linear", "tags": ["TI-101"]},
         {"type": "remove_outlier", "method": "iqr", "tags": ["*"]}]

    `tags` defaults to every tag; `"*"` is an explicit wildcard.
    """
    out = frame
    all_tags = tag_columns(frame)

    def validate_tags(op_type: str, requested: list[str]) -> list[str]:
        unknown = [t for t in requested if t != "*" and t not in all_tags]
        if unknown:
            raise CleaningError(
                f"Operation {op_type!r} targets unknown columns: {sorted(unknown)}. "
                f"Available: {all_tags}."
            )
        return all_tags if "*" in requested else [t for t in all_tags if t in requested]

    for operation in operations:
        op_type = str(operation.get("type", "")).strip()
        if not op_type:
            raise CleaningError("Every operation needs a 'type'.")

        if op_type == "remove_duplicates":
            # Row-level and frame-wide: `tags` cannot scope it. Still validated
            # so a typo surfaces instead of being silently accepted.
            validate_tags(op_type, list(operation.get("tags") or ["*"]))
            out = remove_duplicate_timestamps(out)
            continue

        method = resolve_method(op_type, operation.get("method"))
        targets = validate_tags(op_type, list(operation.get("tags") or ["*"]))
        if not targets:
            continue

        out = preprocess_pipelines(
            out, {tag: [_build_step(method, operation)] for tag in targets}, precision
        )

    return out


# Request field -> internal step field. Ordered by PRECEDENCE, highest first:
# the explicit `param`/`paramLow` names win, then the friendlier per-op
# aliases. Made explicit because relying on dict iteration order to resolve a
# caller sending both `window` and `threshold` would be an invisible rule.
_PARAM_ALIASES: tuple[tuple[str, str], ...] = (
    ("param", "param"),
    ("window", "param"),  # smooth{moving_avg}
    ("alpha", "param"),  # smooth{exponential}
    ("threshold", "param"),  # remove_outlier{zscore}
    ("max", "param"),  # clip upper bound
    ("value", "param"),  # fill_missing{constant}
    ("paramLow", "paramLow"),
    ("min", "paramLow"),  # clip lower bound
)


def _build_step(method: str, operation: Mapping[str, Any]) -> dict[str, Any]:
    step: dict[str, Any] = {"method": method}
    for source, destination in _PARAM_ALIASES:
        if source in operation and destination not in step:
            step[destination] = operation[source]
    return step


def remove_duplicate_timestamps(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep the FIRST row for each duplicated timestamp.

    No browser counterpart exists, so the semantics are defined here rather
    than inferred: whole-frame, keep-first. Deliberately NOT the same as
    `data_service._dedupe`, which de-duplicates on the timestamp STRING at
    batch-window boundaries as a fetch-stitching safety net.
    """
    if TIMESTAMP_COLUMN not in frame.columns:
        raise CleaningError(f"Frame is missing the '{TIMESTAMP_COLUMN}' column.")
    return frame.drop_duplicates(subset=[TIMESTAMP_COLUMN], keep="first").reset_index(
        drop=True
    )


# ── parity harness entry point ───────────────────────────────────────────


def apply_fixture_case(
    frame: pd.DataFrame, config: Mapping[str, Any], engine: str
) -> pd.DataFrame:
    """Replay one golden fixture (`tests/test_parity.py`).

    `precleanse` is not implemented here: its `drop` action DELETES a single
    tag's cell, which a rectangular frame cannot represent without a fourth
    status meaning "absent". That is a deliberate decision for a later slice,
    so those fixtures skip rather than pretending to pass.
    """
    if engine == "preprocessPipelines":
        return preprocess_pipelines(
            frame,
            config.get("pipelines", {}),
            config.get("precision", {}),
        )

    raise NotImplementedError(
        f"Engine {engine!r} is not implemented yet. `precleanse` needs an "
        "'absent cell' representation before it can round-trip through the "
        "canonical frame."
    )
