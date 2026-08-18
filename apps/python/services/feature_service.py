"""Feature-engineering transforms, ported to match the browser bug-for-bug.

Ports `apps/client/lib/feature-engineering.ts` (`applyFeatures`,
`selectColumns`) and the model-ready half of `apps/client/lib/preprocessing.ts`
(`toModelReady`'s four scalers). Same discipline as `cleaning_service.py`:
the browser has been the only implementation, so this reproduces its
behaviour exactly — quirks included — and `packages/parity-fixtures`
(DS-LAKE-006-T01) proves it.

`formula` features ARE ported, via `formula_service.py` — but only the
subset of mathjs that actually reaches this module: numeric literals, alias
identifiers (`c0`, `c1`, …, never real column names — `tokenizeColumns` in
`apps/client/lib/formula.ts` rewrites those away before a formula config is
ever built), `+ - * /`, parentheses, unary sign. `^` and function calls are
deliberately excluded, not merely unimplemented — see `formula_service.py`'s
own module docstring for why (JS/Python numeric divergence on `^`, and the
fact that `toFeatureConfigs` never validates a preset's formula before
sending it here, so this module cannot assume mathjs's full grammar was
ever checked). Anything outside that subset raises `FeatureError` rather
than being guessed at.

Quirks that are load-bearing, each covered by a DS-LAKE-006-T01 fixture:

* **A `rolling` window needs a FULL window of Good source values.** Not a
  partial average at the edges — an incomplete window is Bad, matching
  `rolling_mean`/`rolling_std`/`rolling_roc` fixtures.
* **`ratio`'s divisor(s) being exactly 0 is Bad**, not `Infinity`/`NaN`.
* **`log` of a non-positive value is Bad**, not `NaN`.
* **`toModelReady` scales every FINITE value regardless of its ORIGINAL
  status** and always emits Good afterward — a Bad cell holding a real
  (non-hole) number is silently laundered to Good by scaling. This is why
  the T01 scaler fixtures reuse the same ragged-Bad-cells grid the cleaning
  fixtures use, not a clean one.
* **Two more std conventions coexist** on top of the two `cleaning_service`
  already tracks: `rolling`'s `std` aggregate is SAMPLE std (`/(n-1)`, like
  `precleanse.tagStats`), while `toModelReady`'s `standard` scaler is
  POPULATION std computed via Welford's online algorithm (`/n`), in ROW
  ORDER — not `numpy`'s vectorized reduction, which can differ in the last
  few ULPs for the same mathematical quantity. `_welford_population_std`
  below iterates the frame's own row order for exactly this reason.
* **`robust` scaling's median/IQR are Tukey's exclusive hinges**
  (`_median_sorted` of the lower/upper halves, excluding the middle
  element on an odd count) over SORTED FINITE values — not
  `numpy.percentile`'s interpolated quartiles. See `medianRange` in
  `preprocessing.ts:556`; `_median_sorted(sorted_values[a:b])` is an exact
  match for `medianRange(sorted_values, a, b)`, so it is reused, not
  re-derived.
* **`robust` scaling skips a tag ENTIRELY if it has zero finite values** —
  unlike `minmax`/`standard`, which still force every cell to `(0, Good)`
  in that case. The column is left byte-identical to its input.
* **Every scaled value rounds to 3 decimals UNCONDITIONALLY** — not the
  per-tag `tagMeta(tag)?.precision` the cleaning ops use. Routed through
  `cleaning_service._round_to`, which already reproduces JS `Math.round`'s
  half-up convention (`_js_round`), not Python's banker's rounding.
* **`datetime`'s `dayOfWeek` uses JS's `getUTCDay()` convention**
  (Sunday=0 … Saturday=6), which is NOT pandas's `.dt.dayofweek`
  (Monday=0 … Sunday=6) — converted explicitly in `_datetime_part`, not
  passed through.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    status_column,
    tag_columns,
)
from services.cleaning_service import _median_sorted, _round_to
from services.formula_service import compile_formula, eval_formula_row

DEFAULT_SCALER = "minmax"


class FeatureError(ValueError):
    """Invalid feature config or scaler, safe to surface to the caller."""


# ── column naming, matching featureColumnName exactly ────────────────────


def feature_column_name(cfg: Mapping[str, Any]) -> str:
    kind = cfg.get("kind")
    if kind == "lag":
        return f"{cfg['tag']}__lag{cfg['k']}"
    if kind == "rolling":
        return f"{cfg['tag']}__roll{cfg['window']}_{cfg['agg']}"
    if kind == "ratio":
        return "__over__".join(cfg["tags"])
    if kind == "delta":
        return f"{cfg['tag']}__delta"
    if kind == "arith":
        return f"__{cfg['op']}__".join(cfg["tags"])
    if kind == "log":
        return f"{cfg['tag']}__log"
    if kind == "datetime":
        return f"__dt_{cfg['part']}"
    if kind == "formula":
        name = (cfg.get("name") or "").strip()
        return name or cfg["expr"]
    raise FeatureError(f"Unknown feature kind {kind!r}")


# ── value/status helpers ──────────────────────────────────────────────────


def _good_value(value: float, status: int) -> float | None:
    return value if status == STATUS_GOOD else None


def _aggregate(values: list[float], agg: str) -> float:
    n = len(values)
    if n == 0:
        return 0.0
    if agg == "mean":
        return sum(values) / n
    if agg == "min":
        return min(values)
    if agg == "max":
        return max(values)
    if agg == "std":
        if n < 2:
            return 0.0
        mean = sum(values) / n
        # SAMPLE variance (/(n-1)) — matches precleanse.tagStats, NOT the
        # POPULATION std toModelReady's `standard` scaler uses below.
        variance = sum((v - mean) ** 2 for v in values) / (n - 1)
        return math.sqrt(variance)
    if agg == "ROC":
        if n < 2:
            return 0.0
        first, last = values[0], values[-1]
        return 0.0 if first == 0 else (last - first) / first
    raise FeatureError(f"Unknown rolling aggregate {agg!r}")


def _datetime_part(ts: pd.Series, part: str) -> np.ndarray:
    parsed = pd.to_datetime(ts, utc=True)
    if part == "hour":
        return parsed.dt.hour.to_numpy(dtype="float64")
    if part == "dayOfWeek":
        # pandas: Monday=0..Sunday=6. JS getUTCDay(): Sunday=0..Saturday=6.
        return ((parsed.dt.dayofweek + 1) % 7).to_numpy(dtype="float64")
    if part == "month":
        return parsed.dt.month.to_numpy(dtype="float64")
    raise FeatureError(f"Unknown datetime part {part!r}")


# ── per-config column computation ─────────────────────────────────────────


def _compute_feature_column(
    df: pd.DataFrame, cfg: Mapping[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    """Compute one feature's (values, statuses) over every row.

    Mirrors `computeColumn` (feature-engineering.ts) row by row, not
    vectorised — several kinds (`lag`, `delta`, `rolling`) are inherently
    sequential, and matching the reference implementation's control flow
    exactly is worth more here than raw speed on an interactive-preview-sized
    frame.
    """
    kind = cfg["kind"]
    n = len(df)
    values = np.zeros(n, dtype="float64")
    statuses = np.full(n, STATUS_BAD, dtype="int8")

    if kind == "datetime":
        return _datetime_part(df[TIMESTAMP_COLUMN], cfg["part"]), np.full(
            n, STATUS_GOOD, dtype="int8"
        )

    # Every remaining kind reads from existing tag column(s), which may
    # themselves be a PREVIOUSLY-added feature column — `apply_features`
    # mutates the same frame across configs, so later configs see earlier
    # derived columns, exactly like the TS `rows` array does.
    def source(tag: str) -> tuple[np.ndarray, np.ndarray] | None:
        if tag not in df.columns or status_column(tag) not in df.columns:
            return None
        return (
            df[tag].to_numpy(dtype="float64"),
            df[status_column(tag)].to_numpy(dtype="int8"),
        )

    if kind == "formula":
        # Compiled ONCE per config, outside the row loop — mirrors
        # `computeColumn`'s own `compiled = compileFormula(cfg.expr)` call
        # site, which also runs once before its `rows.map`. Unlike the
        # client, a compile failure here raises immediately (FeatureError)
        # rather than silently emitting an all-Bad column — see
        # formula_service.py's module docstring for why that divergence is
        # deliberate, not an oversight.
        compiled = compile_formula(cfg["expr"])
        var_srcs = {
            alias: source(tag) for alias, tag in cfg["vars"].items()
        }
        for i in range(n):
            scope: dict[str, float] = {}
            row_bad = False
            for alias, src in var_srcs.items():
                v = _good_value(src[0][i], src[1][i]) if src is not None else None
                if v is None:
                    row_bad = True
                    break
                scope[alias] = v
            if row_bad:
                values[i], statuses[i] = 0.0, STATUS_BAD
                continue
            result = eval_formula_row(compiled, scope)
            if result is None:
                values[i], statuses[i] = 0.0, STATUS_BAD
            else:
                values[i], statuses[i] = result, STATUS_GOOD
        return values, statuses

    if kind == "lag":
        src = source(cfg["tag"])
        k = cfg["k"]
        for i in range(n):
            j = i - k
            v = None
            if j >= 0 and src is not None:
                v = _good_value(src[0][j], src[1][j])
            if v is None:
                values[i], statuses[i] = 0.0, STATUS_BAD
            else:
                values[i], statuses[i] = v, STATUS_GOOD
        return values, statuses

    if kind == "delta":
        src = source(cfg["tag"])
        for i in range(n):
            cur = _good_value(src[0][i], src[1][i]
                              ) if src is not None else None
            prev = (
                _good_value(src[0][i - 1], src[1][i - 1])
                if src is not None and i > 0
                else None
            )
            if cur is None or prev is None:
                values[i], statuses[i] = 0.0, STATUS_BAD
            else:
                values[i], statuses[i] = cur - prev, STATUS_GOOD
        return values, statuses

    if kind == "ratio":
        srcs = [source(t) for t in cfg["tags"]]
        for i in range(n):
            vals: list[float] | None = []
            for s in srcs:
                v = _good_value(s[0][i], s[1][i]) if s is not None else None
                if v is None:
                    vals = None
                    break
                vals.append(v)
            if vals is None or any(v == 0 for v in vals[1:]):
                values[i], statuses[i] = 0.0, STATUS_BAD
                continue
            result = vals[0]
            for v in vals[1:]:
                result /= v
            values[i], statuses[i] = result, STATUS_GOOD
        return values, statuses

    if kind == "arith":
        srcs = [source(t) for t in cfg["tags"]]
        op = cfg["op"]
        for i in range(n):
            vals: list[float] | None = []
            for s in srcs:
                v = _good_value(s[0][i], s[1][i]) if s is not None else None
                if v is None:
                    vals = None
                    break
                vals.append(v)
            if vals is None:
                values[i], statuses[i] = 0.0, STATUS_BAD
                continue
            if op == "add":
                result = sum(vals)
            elif op == "mul":
                result = 1.0
                for v in vals:
                    result *= v
            elif op == "sub":
                result = vals[0]
                for v in vals[1:]:
                    result -= v
            else:
                raise FeatureError(f"Unknown arith op {op!r}")
            values[i], statuses[i] = result, STATUS_GOOD
        return values, statuses

    if kind == "log":
        src = source(cfg["tag"])
        for i in range(n):
            v = _good_value(src[0][i], src[1][i]) if src is not None else None
            if v is None or v <= 0:
                values[i], statuses[i] = 0.0, STATUS_BAD
            else:
                values[i], statuses[i] = math.log(v), STATUS_GOOD
        return values, statuses

    if kind == "rolling":
        src = source(cfg["tag"])
        window = cfg["window"]
        agg = cfg["agg"]
        for i in range(n):
            start = max(0, i - window + 1)
            collected: list[float] = []
            complete = True
            for j in range(start, i + 1):
                v = _good_value(src[0][j], src[1][j]
                                ) if src is not None else None
                if v is None:
                    complete = False
                else:
                    collected.append(v)
            if (
                not complete
                or (i - window + 1 < 0)
                or len(collected) < window
            ):
                values[i], statuses[i] = 0.0, STATUS_BAD
            else:
                values[i], statuses[i] = _aggregate(
                    collected, agg), STATUS_GOOD
        return values, statuses

    raise FeatureError(f"Unknown feature kind {kind!r}")


def apply_features(
    df: pd.DataFrame,
    configs: Sequence[Mapping[str, Any]],
    skipped: list[str] | None = None,
) -> pd.DataFrame:
    """Append one derived column per config, in order (`applyFeatures`).

    Duplicate/existing column names are skipped, same as the TS
    `if (tags.includes(col)) continue`. Configs are applied against the
    SAME frame progressively, so a later config can read an earlier
    config's own derived column (DS-LAKE-006-T01's chaining fixture pins
    this). Semantics unchanged (still a silent, idempotent no-op — a
    re-run of the same config list must not raise) — this was a deliberate
    user decision, not a default: a preset can mint a `formula` feature
    whose workbook-derived name collides with a real tag, so `skipped`
    (when the caller passes a list) gets the collided column name appended,
    letting `artifact_service.features` keep `feature_spec.json` from
    claiming a feature that was never computed, without changing what
    `apply_features` itself does.
    """
    out = df.copy()
    for cfg in configs:
        col = feature_column_name(cfg)
        if col in out.columns:
            if skipped is not None:
                skipped.append(col)
            continue
        values, statuses = _compute_feature_column(out, cfg)
        out[col] = values
        out[status_column(col)] = pd.array(statuses, dtype="int8")
    return out


def select_columns(df: pd.DataFrame, kept: list[str] | None) -> pd.DataFrame:
    """Keep only the chosen tag columns, original + engineered (`selectColumns`).

    `kept is None` keeps every column (default) — the TS identity branch.
    """
    if kept is None:
        return df.copy()
    keep = set(kept)
    cols = [TIMESTAMP_COLUMN] + [
        c
        for c in df.columns
        if c != TIMESTAMP_COLUMN
        and (c in keep or (c.endswith("__status") and c[: -len("__status")] in keep))
    ]
    return df[cols].copy()


# ── scaling (toModelReady) ────────────────────────────────────────────────


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


def _scale_column(values: np.ndarray, method: str) -> np.ndarray:
    """Transform one tag's dense values array (`scaleColumn`/`toModelReady` body).

    Every branch here already ran once for its own float; a caller that
    determines the whole column should be left untouched (the `robust`,
    zero-finite-values case) must check for that itself and skip calling
    this at all — this function unconditionally returns a transformed array.
    """
    finite_mask = np.isfinite(values)

    if method == "none":
        return np.array([_round_to(v, 3) for v in values])

    if method == "minmax":
        finite = values[finite_mask]
        if finite.size == 0:
            lo, span = 0.0, 0.0
        else:
            lo = float(finite.min())
            span = float(finite.max()) - lo
        return np.array(
            [0.0 if span == 0 else _round_to(
                (v - lo) / span, 3) for v in values]
        )

    if method == "standard":
        # Row order matters — see _welford_population_std's own docstring.
        finite_in_order = [float(v) for v in values if np.isfinite(v)]
        mean, std = _welford_population_std(finite_in_order)
        return np.array(
            [0.0 if std == 0 else _round_to(
                (v - mean) / std, 3) for v in values]
        )

    if method == "robust":
        finite_sorted = sorted(float(v) for v in values if np.isfinite(v))
        k = len(finite_sorted)
        if k == 0:
            return values.copy()  # caller: skip entirely, do not force Good
        med = _median_sorted(finite_sorted)
        upper = _median_sorted(finite_sorted[math.ceil(k / 2):])
        lower = _median_sorted(finite_sorted[: math.floor(k / 2)])
        iqr = upper - lower
        return np.array(
            [0.0 if iqr == 0 else _round_to(
                (v - med) / iqr, 3) for v in values]
        )

    raise FeatureError(f"Unknown scaler {method!r}")


def assert_target_is_unscaled(target_y: str | None, scalers: dict[str, str]) -> None:
    """The target must not appear in the scaler config at all.

    Not "default it to none" — an explicit refusal. `dwScalerConfigsAtom`
    documents "missing key defaults to min-max", so silence here means the
    target gets min-max scaled, which is the exact opposite of the decision.
    A scaled Y whose scaler params were not persisted makes every prediction
    unrecoverable in engineering units.
    """
    if target_y and target_y in scalers:
        raise ValueError(
            f"'{target_y}' is the target — it must not be scaled. Remove it "
            "from the scaler config; the target is stored in engineering "
            "units so predictions come back directly comparable to the tag."
        )


def force_keep_target(selected: list[str] | None, target_y: str | None) -> list[str] | None:
    """Keep the target through column selection.

    A GOLD artifact whose target column was dropped is not a broken dataset —
    it is an unusable one that looks fine, and only fails at model-fit time in
    a different service.
    """
    if selected is None or not target_y:
        return selected
    return selected if target_y in selected else [*selected, target_y]


def to_model_ready(
    df: pd.DataFrame, tags: list[str], scalers: Mapping[str, str]
) -> pd.DataFrame:
    """Scale every tag column and force its status to Good (`toModelReady`).

    Every FINITE value is scaled regardless of its ORIGINAL status — a Bad
    cell holding a real number is scaled and marked Good, same as the
    browser. `robust` is the one exception: a tag with zero finite values is
    left byte-identical (values AND status), matching the TS `if (k === 0)
    continue` that skips before the status-forcing loop even runs.
    """
    out = df.copy()
    for tag in tags:
        if tag not in out.columns:
            continue
        method = scalers.get(tag, DEFAULT_SCALER)
        values = out[tag].to_numpy(dtype="float64")

        if method == "robust" and not np.isfinite(values).any():
            continue  # column left exactly as-is, status untouched

        scaled = _scale_column(values, method)
        out[tag] = scaled
        out[status_column(tag)] = pd.array(
            np.full(len(out), STATUS_GOOD, dtype="int8"), dtype="int8"
        )
    return out


# ── fixture replay (packages/parity-fixtures) ─────────────────────────────


def apply_fixture_case(
    frame: pd.DataFrame, config: Mapping[str, Any], engine: str
) -> pd.DataFrame:
    """Replay one golden fixture (`tests/test_parity.py`), Gold-layer engines only."""
    if engine == "applyFeatures":
        return apply_features(frame, config.get("features", []))
    if engine == "selectColumns":
        return select_columns(frame, config.get("kept"))
    if engine == "toModelReady":
        return to_model_ready(frame, tag_columns(frame), config.get("scalers", {}))

    raise NotImplementedError(
        f"Engine {engine!r} is not implemented in feature_service — it "
        "belongs to cleaning_service.apply_fixture_case instead."
    )
