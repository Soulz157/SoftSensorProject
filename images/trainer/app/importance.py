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

THREE METHOD VALUES, not two:
  - "impurity"        — feature_importances_ (random_forest, lightgbm, xgboost)
  - "coefficient"      — coef_ (ols, ridge, and svm when its kernel is linear)
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

`standardized` records whether the inputs were scaled (read off
feature_spec["scaling"]) for the two RAW coefficient methods — a coefficient
over unscaled inputs ranks by unit, not by influence (AC27), and this is what
lets the client refuse to rank it rather than silently mis-ranking it. `None`
for "impurity", where the question does not apply.
"""

from __future__ import annotations

from typing import Any, Callable

LogFn = Callable[..., None]

# hgb/hist_gradient_boosting, mlp, grp, non-linear svm, lstm/gru have no
# per-feature quantity this trainer reads — deliberately absent from every
# branch below, falling through to the final `return None`.
_IMPURITY_ALGORITHMS = ("random_forest", "lightgbm", "xgboost")
_COEFFICIENT_ALGORITHMS = ("ols", "ridge")


def extract_feature_importance(
    algorithm: str,
    model: Any,
    feature_cols: list[str],
    feature_spec: dict[str, Any],
    log_fn: LogFn | None = None,
) -> dict[str, Any] | None:
    """`{algorithm, method, standardized, scaling_methods, features}` or
    `None`. Never raises — an extraction failure must not fail an otherwise
    successful run, the same discipline `extract_loss_history` applies to
    itself.
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
            standardized, scaling_methods = _scaling_of(feature_spec)
            return _shape(
                algorithm=algorithm,
                method="coefficient",
                standardized=standardized,
                scaling_methods=scaling_methods,
                feature_cols=feature_cols,
                importances=[abs(float(c)) for c in coefs],
                coefficients=[float(c) for c in coefs],
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
            standardized, scaling_methods = _scaling_of(feature_spec)
            return _shape(
                algorithm=algorithm,
                method="coefficient",
                standardized=standardized,
                scaling_methods=scaling_methods,
                feature_cols=feature_cols,
                importances=[abs(float(c)) for c in coefs],
                coefficients=[float(c) for c in coefs],
            )

        if algorithm == "pls":
            # PLSRegression.coef_ is shape (n_targets, n_features) even for a
            # single target — a PROJECTION through latent components, not the
            # same quantity models.py's other coef_ branches read, hence its
            # own "pls-coefficient" method rather than "coefficient".
            coefs = _as_1d(getattr(model, "coef_", None))
            if not _well_formed(coefs, feature_cols):
                return None
            standardized, scaling_methods = _scaling_of(feature_spec)
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


def _scaling_of(feature_spec: dict[str, Any]) -> tuple[bool, list[str]]:
    """Whether the inputs were scaled, and with what — read off
    feature_spec["scaling"] (feature_spec_service.py's own
    `{tag, method}`-per-tag list), never guessed. A run with no feature_spec
    at all (legacy) reads as unscaled, the same honest default a coefficient
    method's own caller must then refuse to rank (AC27) rather than assume."""
    scaling = feature_spec.get("scaling") or []
    methods = sorted({str(s.get("method")) for s in scaling if s.get("method")})
    return (bool(scaling), methods)


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
