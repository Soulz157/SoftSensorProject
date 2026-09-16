"""Per-feature importance, read off the fitted estimator itself.

Mirrors `metrics.extract_loss_history`'s shape exactly: one best-effort
extraction that must never fail the run, a per-algorithm dispatch, and `None`
meaning "this algorithm has no such quantity to read" — no artifact, no
placeholder, ever.

METHOD DECISION (MODEL-FLOW-019-T09 openDecision 5, resolved by the user
2026-09-07): impurity/`coef_` only — the free, already-computed-inside-the-fit
attribute, never a permutation re-scoring pass. This is biased toward
high-cardinality features (this system's own process-tag frames run ~1,000
distinct against a 32-97 distinct target), which is exactly why `method` is
REQUIRED in the artifact and stated wherever a figure appears — a reader
cannot calibrate an unlabelled number. Permutation importance is a recorded
follow-up, not built here.

FOUR METHOD VALUES, not two:
  - "impurity"        — feature_importances_ (random_forest, lightgbm, xgboost)
  - "coefficient"      — coef_ (ols, ridge, and svm when its kernel is linear)
                          over inputs a RECORDED scaler already made comparable
  - "standardized-coefficient" (MODEL-FLOW-019-T32)
                        — |coef_j| * std(X_j) over the rows the estimator was
                          actually fit on, for those same three algorithms when
                          the inputs were NOT scaled. Its own name for exactly
                          the reason "pls-coefficient" has one: a rescaled
                          quantity is not the quantity, and filing it under a
                          plain coefficient's label is the conflation this
                          module exists to refuse.
  - "pls-coefficient"  — coef_ on PLSRegression, kept SEPARATE from
                          "coefficient": a PLS coefficient is a projection
                          through latent components, not the same quantity an
                          OLS coefficient is, and putting both under one label
                          is exactly the conflation this feature exists to
                          refuse.

`importance` IS ALWAYS NON-NEGATIVE. feature_importances_ already is; coef_ is
SIGNED, and summing a signed vector for a "share of total" is meaningless
(shares could exceed 100% or go negative) and a descending sort would rank the
most negative coefficient last. So for a coefficient method `importance` holds
`abs(coefficient)` and the signed value rides beside it as `coefficient` —
ranking and shares are computed on magnitude, decided here rather than left
for the render to get wrong.

`standardized` records whether a figure is COMPARABLE ACROSS FEATURES — the
question AC27 actually asks. A raw coefficient over unscaled inputs ranks by
unit, not by influence, and this is what lets the client refuse to rank it
rather than silently mis-ranking it. `None` for "impurity", where the question
does not apply.

CORRECTED 2026-09-09 (MODEL-FLOW-019-T32) — it used to read
`bool(feature_spec["scaling"])`, and that answered the wrong question. See
`_scaling_of` below for the measurement; the short version is that `scaling` is
EMPTY on every real spec in this system while `scalingParams` carries the
scalers that were actually fitted, so a fully minmax-scaled ols run and a
genuinely unscaled one both reported `standardized: false` and both rendered
"not ranked". Coverage is now read per feature column off `scalingParams`, the
same per-tag check `assert_scaling_coverage` makes in packages/py-scaling.

PERMUTATION (MODEL-FLOW-023, extended to lstm/gru by MODEL-FLOW-023-T10) is a
SEPARATE function, `extract_permutation_importance` below, not a fifth branch
here. `extract_feature_importance` reads a quantity the FIT already computed;
permutation SCORES a population the fit never saw, needs `predict()` rather
than a fitted attribute, and can be negative — a different question with a
different shape, kept out of this function's `try/except` so a permutation
failure can never be confused with "this algorithm has no such quantity to
read". `lstm`/`gru` still return `None` from THIS function — no impurity, no
coefficient, no plain reading off the fit exists for a sequence model — and
get their ranking from the other one instead.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Mapping

LogFn = Callable[..., None]

# hgb/hist_gradient_boosting, mlp, grp, non-linear svm, lstm, gru have no
# per-feature quantity THIS function reads — deliberately absent from every
# branch below, falling through to the final `return None`. lstm/gru get a
# permutation figure from `extract_permutation_importance` instead; the other
# four remain excluded from both functions (MODEL-FLOW-023's own scope).
_IMPURITY_ALGORITHMS = ("random_forest", "lightgbm", "xgboost")
_COEFFICIENT_ALGORITHMS = ("ols", "ridge")

# MODEL-FLOW-023-T02/T10. A window count below this makes a permuted-vs-
# baseline RMSE drop too noisy to report at all — not a measured threshold,
# a floor picked to match `windowed.py`'s own 30-window training-side refusal
# at one order of magnitude down, since the test split is the smaller share
# of that same floor. Below it, `extract_permutation_importance` returns
# `None` for the whole run rather than a table built on too few points.
_MIN_PERMUTATION_WINDOWS = 10

# MODEL-FLOW-023-T02. Forward passes only (never a refit), so the per-feature
# cost is `n_repeats` calls to `model.predict()` over the already-fitted
# estimator. Ten repeats matches the number MODEL-FLOW-023's own findings
# used to illustrate the (corrected) cost arithmetic — revisit once T02's
# in-image measurement (recorded in the trainer image's own bump log) has run
# against a real dataset; this is a starting point, not a measured constant.
DEFAULT_PERMUTATION_REPEATS = 10


def extract_feature_importance(
    algorithm: str,
    model: Any,
    feature_cols: list[str],
    feature_spec: dict[str, Any],
    train_feature_std: Mapping[str, float] | None = None,
    log_fn: LogFn | None = None,
) -> dict[str, Any] | None:
    """`{algorithm, method, standardized, scaling_methods, features}` or
    `None`. Never raises — an extraction failure must not fail an otherwise
    successful run, the same discipline `extract_loss_history` applies to
    itself.

    `train_feature_std` (MODEL-FLOW-019-T32) is the per-feature population std
    over the rows the estimator was fit on, supplied by the strategy that fit
    it (`TrainingResult.train_feature_std`). Absent — a legacy caller, or a
    strategy with no coefficient to rescale — an unscaled coefficient run keeps
    its existing honest `standardized: false` refusal rather than inventing a
    width.
    """
    try:
        if algorithm in _IMPURITY_ALGORITHMS:
            values = _as_1d(getattr(model, "feature_importances_", None))
            if not _well_formed(values, feature_cols):
                return None
            return _shape(
                algorithm=algorithm,
                method="impurity",
                standardized=None,
                scaling_methods=[],
                feature_cols=feature_cols,
                importances=[abs(float(v)) for v in values],
                coefficients=None,
            )

        if algorithm in _COEFFICIENT_ALGORITHMS:
            coefs = _as_1d(getattr(model, "coef_", None))
            if not _well_formed(coefs, feature_cols):
                return None
            return _coefficient_result(
                algorithm=algorithm,
                coefs=coefs,
                feature_cols=feature_cols,
                feature_spec=feature_spec,
                train_feature_std=train_feature_std,
            )

        if algorithm == "svm":
            # SVR.coef_ only EXISTS for a linear kernel — accessing it on any
            # other kernel raises AttributeError inside sklearn itself, which
            # the outer try/except below already treats as "nothing to
            # read", but checking the kernel explicitly here means a
            # non-linear kernel takes the honest `return None` path rather
            # than relying on an exception from a library internal.
            if getattr(model, "kernel", None) != "linear":
                return None
            coefs = _as_1d(getattr(model, "coef_", None))
            if not _well_formed(coefs, feature_cols):
                return None
            return _coefficient_result(
                algorithm=algorithm,
                coefs=coefs,
                feature_cols=feature_cols,
                feature_spec=feature_spec,
                train_feature_std=train_feature_std,
            )

        if algorithm == "pls":
            # PLSRegression.coef_ is shape (n_targets, n_features) even for a
            # single target — a PROJECTION through latent components, not the
            # same quantity models.py's other coef_ branches read, hence its
            # own "pls-coefficient" method rather than "coefficient".
            coefs = _as_1d(getattr(model, "coef_", None))
            if not _well_formed(coefs, feature_cols):
                return None
            # MODEL-FLOW-019-T32 fixes the PREDICATE here, and deliberately
            # stops there: a scaled PLS run now reports the truth instead of a
            # false `false`, but PLS gets no standardized-coefficient path.
            # Rescaling a latent-component projection by an input's own std is
            # not the same identity that holds for a plain linear coefficient,
            # and this task does not have a measurement to justify claiming it.
            standardized, scaling_methods = _scaling_of(feature_spec, feature_cols)
            return _shape(
                algorithm=algorithm,
                method="pls-coefficient",
                standardized=standardized,
                scaling_methods=scaling_methods,
                feature_cols=feature_cols,
                importances=[abs(float(c)) for c in coefs],
                coefficients=[float(c) for c in coefs],
            )

        return None
    except Exception as exc:  # noqa: BLE001 - best-effort, must never fail the run
        if log_fn:
            log_fn(
                f"feature importance extraction failed for {algorithm}: {exc}",
                "warn",
            )
        return None


def _as_1d(values: Any) -> Any:
    """Flatten a (1, n) or (n, 1) array to (n,) — PLSRegression and a linear
    SVR's `coef_` both come back 2-D even for a single target. `None` passes
    through unchanged so `_well_formed` can refuse it uniformly."""
    if values is None:
        return None
    try:
        import numpy as np

        arr = np.asarray(values)
        return arr.reshape(-1) if arr.ndim > 1 else arr
    except Exception:  # noqa: BLE001 - fall through to the caller's own check
        return values


def _well_formed(values: Any, feature_cols: list[str]) -> bool:
    """LENGTH, not presence — the MODEL-FLOW-013-T05 trap this task's own
    detail names: an attribute that exists as an EMPTY array reads as a real
    (empty) result unless its length is checked against what was actually
    fit, not merely whether the attribute is set. Every value must also be
    finite — a NaN/inf coefficient is not a real number to rank."""
    if values is None:
        return False
    try:
        if len(values) != len(feature_cols):
            return False
        import math

        return all(math.isfinite(float(v)) for v in values)
    except (TypeError, ValueError):
        return False


# The fitted-parameter shapes `to_model_ready` records per scaler, from
# feature_spec_service.py's own documented contract. This is how a method name
# is recovered for a tag that took the DEFAULT scaler and therefore has no
# entry in `scaling` to name it.
_PARAM_SHAPES: dict[frozenset[str], str] = {
    frozenset(("min", "max")): "minmax",
    frozenset(("mean", "std")): "standard",
    frozenset(("median", "iqr")): "robust",
}


def _scaling_of(
    feature_spec: dict[str, Any], feature_cols: list[str]
) -> tuple[bool, list[str]]:
    """Whether every feature was scaled, and with what.

    MODEL-FLOW-019-T32, CORRECTING MODEL-FLOW-019-T09. This read
    `bool(feature_spec["scaling"])`, which is the exact trap
    `assert_scaling_coverage` documents in packages/py-scaling: `scaling` holds
    an entry ONLY for a tag with an EXPLICIT scaler choice, while
    `to_model_ready` defaults every unlisted tag to minmax and records what it
    actually fitted in `scalingParams`.

    Measured 2026-09-09 across all five feature specs referenced by
    ModelTrainingRun in the dev DB: every one has `scaling: []`; four carry 22
    populated `scalingParams` entries (all `{min,max}`) and one carries none.
    So the old predicate returned False for a fully minmax-scaled ols run and
    for a genuinely unscaled one alike, and both rendered "not ranked" — the
    scaled run's coefficients WERE comparable and were refused anyway.

    Coverage is per FEATURE COLUMN, the same per-tag check
    `assert_scaling_coverage` makes, so a PARTIALLY scaled frame reads as not
    comparable rather than as scaled — mixing scaled and raw units across
    features is the very thing that makes a coefficient table meaningless.
    A run with no feature_spec at all (legacy) still reads as unscaled.
    """
    params = feature_spec.get("scalingParams") or {}
    explicit = {
        str(entry.get("tag")): str(entry.get("method"))
        for entry in (feature_spec.get("scaling") or [])
        if entry.get("tag") and entry.get("method")
    }

    methods: set[str] = set()
    covered = 0
    for col in feature_cols:
        fitted = params.get(col)
        if not isinstance(fitted, dict):
            continue
        covered += 1
        method = explicit.get(col) or _PARAM_SHAPES.get(frozenset(fitted.keys()))
        if method:
            methods.add(method)

    standardized = bool(feature_cols) and covered == len(feature_cols)
    return (standardized, sorted(methods))


def _std_vector(
    train_feature_std: Mapping[str, float] | None, feature_cols: list[str]
) -> list[float] | None:
    """One finite, non-negative width per feature, in `feature_cols` order, or
    `None` if even one is missing.

    All-or-nothing on purpose: a standardized coefficient is only comparable
    across features if EVERY feature was rescaled by its own width. Filling a
    gap with 1.0 would silently leave that feature ranked in its raw unit
    beside its rescaled neighbours, which is the mis-ranking AC27 exists to
    prevent, wearing the label that says it was fixed.
    """
    if not train_feature_std:
        return None
    widths: list[float] = []
    for col in feature_cols:
        try:
            width = float(train_feature_std[col])
        except (KeyError, TypeError, ValueError):
            return None
        if not math.isfinite(width) or width < 0:
            return None
        widths.append(width)
    return widths


def _coefficient_result(
    *,
    algorithm: str,
    coefs: Any,
    feature_cols: list[str],
    feature_spec: dict[str, Any],
    train_feature_std: Mapping[str, float] | None,
) -> dict[str, Any]:
    """The shared ols/ridge/linear-svm tail: rank the raw coefficient when a
    recorded scaler already made it comparable, otherwise standardise it, and
    otherwise say plainly that it is not rankable.

    The three outcomes are ordered so that an ALREADY-SCALED run is untouched
    by MODEL-FLOW-019-T32 — it keeps reporting the plain `coefficient` method
    it always reported, and only its `standardized`/`scaling_methods` become
    true rather than falsely empty.
    """
    standardized, scaling_methods = _scaling_of(feature_spec, feature_cols)
    signed = [float(c) for c in coefs]

    if standardized:
        return _shape(
            algorithm=algorithm,
            method="coefficient",
            standardized=True,
            scaling_methods=scaling_methods,
            feature_cols=feature_cols,
            importances=[abs(c) for c in signed],
            coefficients=signed,
        )

    widths = _std_vector(train_feature_std, feature_cols)
    if widths is not None:
        # |coef_j| * std(X_j) — the coefficient expressed per one standard
        # deviation of its own input. Dimensionless, comparable across
        # features, and identical to what a refit on scaled inputs would
        # report, with no refit and no change to the user's preprocessing.
        return _shape(
            algorithm=algorithm,
            method="standardized-coefficient",
            standardized=True,
            scaling_methods=scaling_methods,
            feature_cols=feature_cols,
            importances=[abs(c) * w for c, w in zip(signed, widths)],
            coefficients=signed,
        )

    return _shape(
        algorithm=algorithm,
        method="coefficient",
        standardized=False,
        scaling_methods=scaling_methods,
        feature_cols=feature_cols,
        importances=[abs(c) for c in signed],
        coefficients=signed,
    )


def _shape(
    *,
    algorithm: str,
    method: str,
    standardized: bool | None,
    scaling_methods: list[str],
    feature_cols: list[str],
    importances: list[float],
    coefficients: list[float] | None,
) -> dict[str, Any]:
    features = []
    for i, name in enumerate(feature_cols):
        entry: dict[str, Any] = {"name": name, "importance": importances[i]}
        if coefficients is not None:
            entry["coefficient"] = coefficients[i]
        features.append(entry)
    return {
        "algorithm": algorithm,
        "method": method,
        "standardized": standardized,
        "scaling_methods": scaling_methods,
        "features": features,
    }


def extract_permutation_importance(
    algorithm: str,
    model: Any,
    feature_cols: list[str],
    X: Any,
    y: Any,
    seed: int,
    population: str,
    n_repeats: int = DEFAULT_PERMUTATION_REPEATS,
    log_fn: LogFn | None = None,
) -> dict[str, Any] | None:
    """`{algorithm, method, scored_on, metric, n_repeats, baseline_score,
    features}` or `None`. Never raises — same best-effort discipline as
    `extract_feature_importance`.

    MODEL-FLOW-023-T10. `X` is a WINDOW tensor, `(n_windows, sequence_length,
    len(feature_cols))` — `sklearn.inspection.permutation_importance` does not
    accept that shape, so this is hand-rolled rather than a call to it.

    THE PERMUTED UNIT IS A FEATURE CHANNEL, NEVER A CELL AND NEVER A ROW. For
    feature `j`, `X[:, :, j]` — that channel's whole history, across every
    window — is reassigned window-for-window by a random permutation of the
    window axis; each window's own internal timestep order is left intact. Two
    things this is deliberately not: per-CELL permutation across
    `n_features * sequence_length` cells, which would be a different (larger)
    experiment and would destroy the temporal structure WITHIN a window; and
    row-wise shuffling, which this system's own measured lag-1 autocorrelation
    of 0.9992 (MODEL-FLOW-016 finding 1) would make indistinguishable from
    noise — a row-wise shuffle measures the shuffle, not the feature.

    THE METRIC IS RMSE, MINIMISED, NOT R² — MODEL-FLOW-005's own reason: a
    real run once scored r2 = -1,110,858 while its rmse stayed readable. A
    feature's `importance_raw` is `permuted_rmse - baseline_rmse` averaged
    over `n_repeats` reshuffles; positive means permuting that channel made
    the model WORSE, i.e. the channel carried real signal.

    NEGATIVES ARE NOT abs()'d. A negative drop means the feature contributed
    nothing (permuting it, by chance, IMPROVED the score) — its magnitude
    would rank a noise feature above a genuinely weak-but-positive one, which
    is the inversion `abs()` would cause. `importance` is the CLAMPED value
    (`max(0, importance_raw)`) that a share column can safely sum; the signed
    `importance_raw` rides beside it, unclamped, the same two-fields-not-one
    shape `_coefficient_result` already uses for a signed coefficient. `std`
    (population std across the `n_repeats` reshuffles, `ddof=0`) is REQUIRED,
    never optional — at this system's 32-97 distinct labelled values the std
    will often exceed the mean, and that is the method working, not a defect;
    a reader needs the spread to know whether a positive mean is real. Ranking
    a feature whose interval spans zero is the CLIENT's decision (it has the
    display context for "not ranked"), not this function's — this function
    only ever reports the two numbers a caller needs to make that call.

    `n_windows` below `_MIN_PERMUTATION_WINDOWS` refuses the WHOLE run —
    write nothing rather than a table built on too few points to mean
    anything, the same all-or-nothing discipline `_std_vector` already
    applies for a standardized coefficient.
    """
    try:
        import numpy as np

        from metrics import regression_metrics

        X = np.asarray(X)
        y = np.asarray(y)
        if X.ndim != 3 or X.shape[2] != len(feature_cols):
            return None
        n_windows = X.shape[0]
        if n_windows < _MIN_PERMUTATION_WINDOWS:
            if log_fn:
                log_fn(
                    f"permutation importance skipped for {algorithm}: only "
                    f"{n_windows} {population} windows, too few for a drop "
                    f"to mean anything (minimum {_MIN_PERMUTATION_WINDOWS}).",
                    "warn",
                )
            return None

        baseline_pred = model.predict(X)
        baseline_rmse = regression_metrics(y, baseline_pred)["rmse"]
        if not math.isfinite(baseline_rmse):
            return None

        rng = np.random.default_rng(seed)
        features: list[dict[str, Any]] = []
        for j, name in enumerate(feature_cols):
            X_perm = X.copy()
            drops = np.empty(n_repeats)
            for r in range(n_repeats):
                order = rng.permutation(n_windows)
                X_perm[:, :, j] = X[order, :, j]
                permuted_pred = model.predict(X_perm)
                drops[r] = (
                    regression_metrics(y, permuted_pred)["rmse"] - baseline_rmse
                )
            raw = float(drops.mean())
            std = float(drops.std(ddof=0))
            if not (math.isfinite(raw) and math.isfinite(std)):
                return None
            features.append(
                {
                    "name": name,
                    "importance": max(0.0, raw),
                    "importance_raw": raw,
                    "std": std,
                }
            )

        return {
            "algorithm": algorithm,
            "method": "permutation",
            "scored_on": population,
            "metric": "rmse",
            # MODEL-FLOW-023-T10/AC16. The scored population's own size — a
            # WINDOW count for a sequence run (X.shape[0] here, never a row
            # count), stated so a reader does not assume uniformity with a
            # future tabular permutation's row-counted population. The unit
            # itself is not named here (that reads `scored_on`); this is
            # only ever the count.
            "n": n_windows,
            "n_repeats": n_repeats,
            "baseline_score": baseline_rmse,
            "features": features,
        }
    except Exception as exc:  
        if log_fn:
            log_fn(
                f"permutation importance extraction failed for {algorithm}: {exc}",
                "warn",
            )
        return None
