"""The estimator factory, and the two measured ceilings that refuse a fit which
would otherwise be killed by the cgroup with no Python-level error at all.

Deliberately ONE flat dispatch over all 11 algorithms rather than a package of
per-family modules: the branches are only comparable if they can be read side by
side, and the thing a maintainer most often needs from this file is "what does
algorithm X do differently from algorithm Y".

The local-import-per-branch style is also deliberate and preserved: lightgbm,
xgboost and torch are heavy, and a run that uses none of them should not pay to
import them. `import sklearn` stays module-level in `manifest.py` for the
opposite reason (MODEL-FLOW-007-T11) — every run goes through it.
"""

from __future__ import annotations

from typing import Any, Callable

LogFn = Callable[..., None]

# Measured against this image (scikit-learn 1.5.2) under the production
# container's own resource limits — Memory=8GiB (no swap), NanoCpus=2,
# tmpfs /scratch=2GiB (trainning-container.authorized.service.ts) — by
# fitting GaussianProcessRegressor on synthetic (n, 10) data at increasing n
# and recording peak RSS (resource.getrusage) and wall time:
#
#     n        time_s   peak_rss_gib
#     500      0.01     0.18
#     1,000    3.30     0.20
#     2,000    5.68     0.28
#     4,000    16.15    0.54
#     8,000    43.73    1.60
#     10,000   62.33    2.44   <- chosen ceiling
#     12,000   89.78    3.39
#
# Peak RSS fits ~24 bytes * n^2 (three n x n float64 matrices — kernel,
# kernel gradient, Cholesky factor), confirming the O(n^2) memory model an
# OOM kill would otherwise hide: the container is killed by the cgroup, not
# by Python, so no RuntimeError is ever raised and the only surfaced message
# is the exit-code backstop's "Container exited 137" (trainning-container.
# authorized.service.ts watch()). At n=10,000 (2.44 GiB) there is ample
# headroom below the 8 GiB cap after reserving budget for the in-memory
# pandas frame (~1 GiB) and the tmpfs artifacts including model.joblib,
# which for GPR holds an n x n Cholesky factor of comparable size to the fit
# itself (~1-1.5 GiB reserved). Wall time at the threshold is ~1 minute,
# well inside a background training job's patience. Measured 2026-08-18
# against scgc/soft-sensor-trainer:1.0.1.
#
# Measured at 10 features; this system also produces very wide artifacts
# (docs/DS-LAKE-005B-C-BENCHMARK.md records a 16,001-column one). X_train_
# is n*d*8 bytes and kernel distance work is O(n^2*d), so a wide frame eats
# further into the reserve and inflates wall time beyond this table — the
# margin below (10,000 vs the ~15,700 the memory model alone would allow)
# is there to absorb that, not measured at d >> 10 directly.
GPR_MAX_TRAIN_ROWS = 10_000

# Measured against this image (1.0.4, torch 2.5.1) under the production
# container's own resource limits — Memory=8GiB (no swap), NanoCpus=2, tmpfs
# /scratch=2GiB (trainning-container.authorized.service.ts) — by fitting
# SequenceRegressor(hidden_size=64) on synthetic (n, 24, 20) windows at
# increasing n (3 epochs, batch_size=32) and recording peak RSS
# (resource.getrusage) and wall time:
#
#     n_windows   time_s   peak_rss_gib
#     500         0.39     0.274
#     1,000       0.30     0.275
#     2,000       0.58     0.278
#     4,000       1.21     0.289
#     8,000       2.34     0.311
#     16,000      4.74     0.354
#     32,000      9.48     0.473
#     50,000      14.84    0.570   <- chosen ceiling
#     75,000      22.33    0.598
#
# A DIFFERENT shape from GPR_MAX_TRAIN_ROWS above: torch's memory profile
# here is dominated by the (batch_size, sequence_length, hidden_size)
# working set, not an n x n kernel matrix, so both time AND peak RSS scale
# roughly LINEARLY with n_windows rather than O(n^2) — no natural point
# where OOM risk spikes was found anywhere in the tested range. 50,000 is
# chosen the same way GPR_MAX_TRAIN_ROWS was: the largest value ACTUALLY
# MEASURED with a safety margin still shown beyond it (75,000), not an
# extrapolation into unmeasured territory. At the chosen ceiling, peak RSS
# (0.57 GiB) leaves the same ample headroom below the 8 GiB cap that
# GPR_MAX_TRAIN_ROWS reasons about, after reserving budget for the
# in-memory pandas frame and tmpfs artifacts.
#
# Wall time at 3 benchmark epochs extrapolates LINEARLY to the wizard's own
# epochs default (50, training-config.ts): 14.84s * 50/3 ≈ 247s (~4.1 min)
# at the ceiling — comfortably inside a background training job's
# patience, well under the ~1 minute GPR's OWN ceiling took at ITS limit
# for comparison of scale, not equivalence of shape.
#
# A REAL, LIVE-VERIFIED finding from producing this table, not incidental:
# the first benchmark attempt (before this constant was set) measured 500
# windows x 3 epochs taking OVER 10 MINUTES pegged at ~196% CPU — torch's
# default intra-op thread pool sizes itself off every logical core the
# KERNEL reports, which `docker run --cpus=2` does not change (cgroups
# throttle CPU TIME, not `os.cpu_count()`'s answer) — so on a host with
# more cores than the 2-CPU production budget, torch oversubscribed the
# quota and thrashed. Fixed in sequence_model.py
# (torch.set_num_threads/set_num_interop_threads, capped to the SAME 2
# NanoCpus is set to) BEFORE this table was measured — the numbers above
# are POST-fix. Recorded here because a future reader benchmarking a
# DIFFERENT torch-based algorithm against this same container will hit
# the identical trap if that fix is not already in whatever module they
# add.
#
# Measured 2026-08-31 against scgc/soft-sensor-trainer:1.0.4.
LSTM_MAX_TRAIN_WINDOWS = 50_000

SEQUENCE_ALGORITHMS = ("lstm", "gru")


def build_model(
    algorithm: str,
    hyperparameters: dict[str, Any],
    seed: int,
    n_train_rows: int,
    feature_spec: dict[str, Any],
    log_fn: LogFn | None = None,
):
    """Construct the estimator only. Never sees the split, for any algorithm.

    `n_train_rows` is a WINDOW count for lstm/gru and a ROW count for everything
    else — the caller resolves that, because only the caller knows which it
    produced.
    """
    from sklearn.cross_decomposition import PLSRegression
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.linear_model import LinearRegression, Ridge
    from sklearn.neural_network import MLPRegressor
    from sklearn.svm import SVR

    if algorithm in ("hgb", "hist_gradient_boosting"):
        return HistGradientBoostingRegressor(
            learning_rate=float(hyperparameters.get("learning_rate", 0.1)),
            max_iter=int(hyperparameters.get("n_estimators", 200)),
            max_leaf_nodes=int(hyperparameters.get("num_leaves", 31)),
            random_state=seed,
        )
    if algorithm == "ridge":
        # random_state dropped: Ridge only consults it for solver='sag'/'saga',
        # neither of which is reachable here — it was inert, not load-bearing.
        return Ridge(alpha=float(hyperparameters.get("alpha", 1.0)))
    if algorithm == "ols":
        # `fit_intercept` is the UI's only ols knob (training-config.ts:42-49)
        # and was previously collected, validated, and echoed into
        # run_manifest.json while LinearRegression() silently ignored it.
        return LinearRegression(
            fit_intercept=bool(hyperparameters.get("fit_intercept", True))
        )
    if algorithm == "svm":
        # feature_spec["scaling"] is written by the pipeline
        # (feature_spec_service.py) but otherwise never read by this trainer
        # — only the target's scaling is gated, upstream. SVR is the one
        # algorithm sensitive enough to unscaled inputs that its absence is
        # worth naming. Not fatal: the user may want to see exactly that
        # result.
        if not feature_spec.get("scaling") and log_fn:
            log_fn(
                "SVR is scale-sensitive (superlinear in samples, kernel "
                "distances dominated by feature magnitude) and "
                "feature_spec.json reports no scaling on the input "
                "features — results may be dominated by whichever feature "
                "has the largest raw magnitude.",
                "warn",
            )
        return SVR(
            C=float(hyperparameters.get("C", 1.0)),
            kernel=str(hyperparameters.get("kernel", "rbf")),
            epsilon=float(hyperparameters.get("epsilon", 0.1)),
        )
    if algorithm == "mlp":
        # UI sends a scalar hidden layer size (training-config.ts:80-105);
        # MLPRegressor wants a tuple of layer sizes.
        hidden = int(hyperparameters.get("hidden_layer_sizes", 100))
        return MLPRegressor(
            hidden_layer_sizes=(hidden,),
            alpha=float(hyperparameters.get("alpha", 0.0001)),
            max_iter=int(hyperparameters.get("max_iter", 200)),
            random_state=seed,
        )
    if algorithm == "grp":
        if n_train_rows > GPR_MAX_TRAIN_ROWS:
            raise RuntimeError(
                "Gaussian Process Regression allocates an n x n kernel "
                f"matrix and is O(n^3) in fit time; {n_train_rows} train "
                f"rows exceeds the measured ceiling of {GPR_MAX_TRAIN_ROWS} "
                "for this container's memory limit (see GPR_MAX_TRAIN_ROWS "
                "in models.py for how that number was measured). Use Random "
                "Forest, LightGBM, or XGBoost for a dataset this size, or "
                "shorten the training window."
            )
        return GaussianProcessRegressor(
            alpha=float(hyperparameters.get("alpha", 1e-10)),
            n_restarts_optimizer=int(
                hyperparameters.get("n_restarts_optimizer", 0)),
            random_state=seed,
        )
    if algorithm == "pls":
        # No manual clamp on n_components vs. feature count: sklearn already
        # raises a clear ValueError ("`n_components` upper bound is N")
        # which the top-level handler reports verbatim as failureReason — as
        # actionable as anything we'd write here, so it is left to surface
        # unmodified.
        return PLSRegression(
            n_components=int(hyperparameters.get("n_components", 2)),
            max_iter=int(hyperparameters.get("max_iter", 500)),
        )
    if algorithm == "random_forest":
        # `max_depth` is a nullable-number in the UI (null = unlimited
        # depth, training-config.ts:176-181) — None must stay None, never
        # be coerced through int().
        max_depth = hyperparameters.get("max_depth")
        return RandomForestRegressor(
            n_estimators=int(hyperparameters.get("n_estimators", 100)),
            max_depth=int(max_depth) if max_depth is not None else None,
            random_state=seed,
        )
    if algorithm == "lightgbm":
        import lightgbm

        # lightgbm 4.x moved goss from a boosting_type value to its own
        # data_sample_strategy param; passing boosting_type='goss' still
        # works (verified against the pinned 4.5.0) but prints a
        # "backwards compatibility" warning on every fit. Map it explicitly
        # instead of letting a deprecation path run silently on every run.
        ui_boosting_type = str(hyperparameters.get("boosting_type", "gbdt"))
        if ui_boosting_type == "goss":
            boosting_kwargs = {"boosting_type": "gbdt",
                               "data_sample_strategy": "goss"}
        else:
            boosting_kwargs = {"boosting_type": ui_boosting_type}
        return lightgbm.LGBMRegressor(
            learning_rate=float(hyperparameters.get("learning_rate", 0.1)),
            num_leaves=int(hyperparameters.get("num_leaves", 31)),
            random_state=seed,
            **boosting_kwargs,
        )
    if algorithm == "xgboost":
        import xgboost

        # eval_metric set HERE, not at .fit() time: xgboost's sklearn API
        # (pinned 2.1.2) deprecates passing eval_metric to .fit(), warning
        # to set it in the constructor instead — this is purely for
        # MODEL-FLOW-013-T05's loss-history recording, never consulted for
        # early stopping (none is configured, so it never changes when
        # training stops or what the fitted model is).
        return xgboost.XGBRegressor(
            n_estimators=int(hyperparameters.get("n_estimators", 100)),
            learning_rate=float(hyperparameters.get("learning_rate", 0.1)),
            max_depth=int(hyperparameters.get("max_depth", 6)),
            random_state=seed,
            eval_metric="rmse",
        )
    if algorithm in SEQUENCE_ALGORITHMS:
        # MODEL-FLOW-009-T04. Windowing and splitting have already run by the
        # time this is called — this branch only constructs the estimator, the
        # same division of labour every other branch here has. n_train_rows is
        # a WINDOW count here, the same enforcement discipline the grp branch
        # above applies to GPR_MAX_TRAIN_ROWS.
        if n_train_rows > LSTM_MAX_TRAIN_WINDOWS:
            raise RuntimeError(
                f"{n_train_rows} training windows exceeds the measured "
                f"ceiling of {LSTM_MAX_TRAIN_WINDOWS} for this container's "
                "memory/CPU limits (see LSTM_MAX_TRAIN_WINDOWS in models.py "
                "for how that number was measured). Try a shorter "
                "sequence_length, or Random Forest/LightGBM/XGBoost for a "
                "dataset this size."
            )
        from sequence_model import SequenceRegressor

        return SequenceRegressor(
            algorithm=algorithm,
            hidden_size=int(hyperparameters.get("hidden_size", 64)),
            epochs=int(hyperparameters.get("epochs", 50)),
            batch_size=int(hyperparameters.get("batch_size", 32)),
            seed=seed,
        )
    raise RuntimeError(f"Unsupported algorithm '{algorithm}'.")
