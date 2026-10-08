"""Every number this trainer reports.

`regression_metrics` exists because the original file wrote
`float(np.sqrt(mean_squared_error(...)))` in five places — test, train, each CV
fold, the inline holdout, and the score-mode holdout. Adding a fourth metric
meant editing five sites; getting the sqrt wrong in one meant one plausible
number out of five being wrong, which nothing downstream could detect.

sklearn.metrics is imported at module level here, unlike the estimator imports in
models.py: sklearn is present on every run regardless of the final estimator, so
there is nothing to defer.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

LogFn = Callable[..., None]

# MODEL-FLOW-013-T05. A run with many thousands of boosting iterations must not
# ship an unbounded loss-history array. Refused BY NAME — soft-skipped (no
# artifact, no placeholder, logged as a warning) rather than silently truncated
# or sampled, the same discipline apps/python's MAX_PREDICTION_POINTS applies to
# a training run's other array-shaped artifact. Never fails the run:
# model.joblib/metrics.json are what matters, and this is best-effort alongside
# them. Deferred design for whoever hits this cap first: aggregate by
# evenly-spaced index rather than truncate from either end, so the SHAPE of a
# long run's curve stays visible instead of being cut off mid-descent.
MAX_LOSS_HISTORY_POINTS = 5_000


def regression_metrics(y_true, y_pred, prefix: str = "") -> dict[str, float]:
    """r2/mae/rmse over one pair of arrays, optionally key-prefixed.

    `prefix="train_"` is how MODEL-FLOW-013-T04's naming is applied: named
    train_* so nothing later mistakes these for holdout figures, which are a
    distinct object — MODEL-FLOW-004 already had to rename a heading for
    exactly that confusion.
    """
    return {
        f"{prefix}r2": float(r2_score(y_true, y_pred)),
        f"{prefix}mae": float(mean_absolute_error(y_true, y_pred)),
        f"{prefix}rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
    }


def aggregate_fold_metrics(fold_records: Sequence[dict[str, Any]]) -> dict[str, float]:
    """MODEL-FLOW-016-T05. Mean AND spread, or CV was pointless: a model at
    rmse 0.6±0.02 and one at 0.6±0.4 are not the same model.

    Named cv_* so nothing mistakes these for the refit's own held-out score —
    that number, when it exists, comes from the SEPARATE holdout-scoring phase
    (T07), never from these fold statistics.
    """
    out: dict[str, float] = {}
    for key in ("r2", "rmse", "mae"):
        values = [f[key] for f in fold_records]
        out[f"cv_{key}_mean"] = float(np.mean(values))
        out[f"cv_{key}_std"] = float(np.std(values))
    return out


def extract_loss_history(
    algorithm: str, model: Any, log_fn: LogFn | None = None
) -> dict[str, Any] | None:
    """Per-iteration loss trajectory for the algorithms that genuinely have one.

    Returns None for a closed-form algorithm (ols/ridge/pls/grp/svm/
    random_forest) — no artifact, no placeholder, per this feature's own
    instruction: a curve cannot be produced for these, not merely "has not been
    produced yet."

    `metric` names exactly what is plotted, never assumed comparable across
    algorithms: "rmse" for lightgbm/xgboost, because the fit explicitly requests
    that eval_metric so it IS the same number metrics.json reports; "loss" for
    mlp/hist_gradient_boosting/lstm/gru, whose native trajectory is in the
    estimator's own loss units — forcing an RMSE label on those would be false,
    the exact failure class this feature's findings name.

    NOTE for whoever adds algorithm #12: this switch and `models.build_model`'s
    switch are the two places keyed on the same algorithm string. Adding to one
    and not the other yields a run that fits successfully with a silently
    missing loss chart. A single algorithm registry would remove that trap and
    is the natural next refactor; it was deliberately NOT bundled into this
    split, which preserves behaviour exactly.
    """
    try:
        if algorithm == "mlp":
            # MLPRegressor exposes no validation curve without
            # early_stopping=True (not configured — forcing it on would
            # carve a held-out slice out of every mlp run's training data,
            # changing model quality outside this feature's scope). Train
            # series only, honestly.
            series = {"train": [float(v) for v in model.loss_curve_]}
            metric = "loss"
        elif algorithm in ("hgb", "hist_gradient_boosting"):
            # LIVE-VERIFIED against the pinned scikit-learn (1.5.2): both
            # train_score_ and validation_score_ ALWAYS exist as attributes,
            # but are EMPTY arrays (not absent) whenever `early_stopping`
            # resolves to False — the unconfigured default ('auto') for any
            # dataset at or under 10,000 training rows, which is the common
            # case in this trainer's domain (see GPR_MAX_TRAIN_ROWS). `len()
            # == 0`, not `hasattr`/`is None`, is what actually distinguishes
            # "no trajectory this run" from a real one. Never forced on —
            # forcing early_stopping=True would carve a held-out slice out
            # of every hgb run's training data, changing model quality
            # outside this feature's scope, the same reason mlp's branch
            # above does not force it either.
            train_score = model.train_score_
            if len(train_score) == 0:
                return None
            series = {"train": [float(v) for v in train_score]}
            validation_score = getattr(model, "validation_score_", None)
            if validation_score is not None and len(validation_score) > 0:
                series["validation"] = [float(v) for v in validation_score]
            metric = "loss"
        elif algorithm == "lightgbm":
            evals = model.evals_result_
            series = {
                "train": [float(v) for v in evals["train"]["rmse"]],
                "validation": [float(v) for v in evals["validation"]["rmse"]],
            }
            metric = "rmse"
        elif algorithm == "xgboost":
            evals = model.evals_result()
            # eval_set order at the fit call is [train, test] -> xgboost's own
            # "validation_0"/"validation_1" keys, in that order.
            series = {
                "train": [float(v) for v in evals["validation_0"]["rmse"]],
                "validation": [float(v) for v in evals["validation_1"]["rmse"]],
            }
            metric = "rmse"
        elif algorithm in ("lstm", "gru"):
            # MODEL-FLOW-009-T04. SequenceRegressor.fit (sequence_model.py)
            # records train_loss_/validation_loss_ itself, per-epoch, in the
            # SAME attribute-on-the-fitted-estimator shape every other
            # algorithm's branch here reads from — no special access path.
            train_loss = model.train_loss_
            if not train_loss:
                return None
            series = {"train": [float(v) for v in train_loss]}
            if model.validation_loss_:
                series["validation"] = [float(v)
                                        for v in model.validation_loss_]
            # MSELoss — the loss SequenceRegressor.fit actually minimizes —
            # not "rmse": the value plotted is the un-rooted mean squared
            # error, and labelling it rmse would repeat the exact
            # mismatched-unit failure this function's own docstring warns
            # against for mlp/hist_gradient_boosting.
            metric = "loss"
        else:
            return None
    except Exception as exc:  # noqa: BLE001 - best-effort, must never fail the run
        if log_fn:
            log_fn(
                f"loss history extraction failed for {algorithm}: {exc}", "warn")
        return None

    longest = max(len(s) for s in series.values())
    if longest > MAX_LOSS_HISTORY_POINTS:
        if log_fn:
            log_fn(
                f"loss history for {algorithm} has {longest} points, over "
                f"MAX_LOSS_HISTORY_POINTS ({MAX_LOSS_HISTORY_POINTS}) — "
                "skipped, not truncated.",
                "warn",
            )
        return None

    return {"algorithm": algorithm, "metric": metric, "series": series}
