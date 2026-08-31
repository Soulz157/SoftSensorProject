"""Training entrypoint. One run, one target, one exit.

Reads the GOLD artifact over a presigned URL — this process never holds S3
credentials, matching the rule the connector service states on itself. It
talks to exactly two hosts: the internal API (for its spec and its result)
and object storage (for bytes).

The step ORDER below is not cosmetic. Steps 6-7 (drop non-Good target) must
precede step 8 (split), because a lab target sampled daily against a 1-minute
PI grid has orders of magnitude fewer labels than rows: splitting first yields
a "20,000-row test set" holding a dozen labels, and every number reported off
it is meaningless while looking entirely plausible.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests
# MODEL-FLOW-007-T11. Module-level, not the local-import-per-branch style
# build_model uses below — every run goes through sklearn regardless of the
# final estimator (scalers/preprocessing), so its version belongs in every
# manifest, not just the algorithms that import it inside build_model.
import sklearn

SCRATCH = Path("/scratch")
STATUS_SUFFIX = "__status"
STATUS_GOOD = 0
TIMESTAMP_COLUMN = "timestamp"

RUN_ID = os.environ["RUN_ID"]
RUN_TOKEN = os.environ["RUN_TOKEN"]
API_BASE = os.environ["API_BASE"].rstrip("/")

SESSION = requests.Session()
SESSION.headers.update({"Authorization": f"Bearer {RUN_TOKEN}"})
API = f"{API_BASE}/api/v1/authorized/model/runs/{RUN_ID}"


def log(message: str, level: str = "info") -> None:
    """Best-effort remote log. Never fatal.

    A logging outage must not fail a training run that is otherwise fine, so
    this swallows transport errors — but it always mirrors to stderr, which
    the runner captures from the container's exit path.
    """
    print(f"[{level}] {message}", file=sys.stderr, flush=True)
    try:
        SESSION.post(f"{API}/log", json={"level": level,
                     "message": message}, timeout=10)
    except requests.RequestException:
        pass


def download(url: str, dest: Path) -> Path:
    """Stream to local disk in full before anything reads it.

    Deliberately not lazy. The presigned URL is short-lived by design; a
    reader that issues range requests hours into a fit gets a 403 halfway
    through, which surfaces as a corrupt-looking read rather than an auth
    failure.

    Deliberately NOT `SESSION`: that carries the run token, and S3/MinIO
    reject a request presenting both query-string auth and an Authorization
    header. The upload path below already uses bare `requests` for exactly
    this reason — the asymmetry was the bug, not the design.
    """
    with requests.get(url, stream=True, timeout=300) as response:
        response.raise_for_status()
        with dest.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                handle.write(chunk)
    return dest


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def status_column(tag: str) -> str:
    return f"{tag}{STATUS_SUFFIX}"


def labelled_mask(frame: pd.DataFrame, target_y: str, log_fn=None) -> pd.Series:
    """DS-LAKE-023-T03/D4. The SAME non-Good-target mask the train/test split
    (steps 6-7) already applies, extracted so the holdout scoring block can
    apply it too. Before this fix, nothing dropped an unlabelled row from the
    holdout: for a lab target sampled far sparser than the PI grid, the
    holdout window is mostly unlabelled, `r2_score` raises on NaN, and the
    best-effort `except Exception` around holdout scoring swallowed it —
    meaning holdout metrics likely never rendered at all for exactly the
    dataset shape this feature (DS-LAKE-023) exists to improve.

    `log_fn` is optional so this stays callable from a context (or a test)
    with no `log()` of its own; the train/test call site passes the real one.
    """
    target_status = status_column(target_y)
    if target_status in frame.columns:
        mask = frame[target_status] == STATUS_GOOD
    else:
        if log_fn:
            log_fn(
                f"'{target_status}' absent — falling back to non-null target",
                "warn",
            )
        mask = frame[target_y].notna()
    return mask & frame[target_y].notna()


def median_gap_minutes(series: pd.Series) -> float | None:
    """Median spacing between consecutive entries, in minutes."""
    if len(series) < 3:
        return None
    deltas = series.sort_values().diff().dropna()
    if deltas.empty:
        return None
    return float(deltas.dt.total_seconds().median() / 60.0)


def assert_no_target_leakage(
    frame: pd.DataFrame,
    target_y: str,
    derived: list[str],
    label_mask: pd.Series,
) -> None:
    """Refuse a run whose target-derived features cannot carry real history.

    The failure this catches looks like success, which is why it is fatal
    rather than a warning. If the target is a lab value arriving daily but
    the frame is on a 1-minute grid, a forward-filled `Y_lag1` holds the SAME
    value as the current target — the model reads the answer off its own
    input and reports R² near 1.0.

    The comparison is between the target's own labelled spacing and the
    frame's row spacing: derived features are computed in ROWS, so a lag of
    n rows only reaches genuinely earlier information when n rows span more
    than one target sampling interval.
    """
    if not derived:
        return

    label_gap = median_gap_minutes(frame.loc[label_mask, TIMESTAMP_COLUMN])
    row_gap = median_gap_minutes(frame[TIMESTAMP_COLUMN])
    if label_gap is None or row_gap is None or row_gap <= 0:
        log("Could not establish sampling intervals — skipping leakage check", "warn")
        return

    rows_per_label = label_gap / row_gap
    if rows_per_label > 1.5:
        raise RuntimeError(
            f"Target-derived features {derived} cannot carry real history: the "
            f"target is labelled every ~{label_gap:.0f} min but rows are "
            f"~{row_gap:.0f} min apart (~{rows_per_label:.0f} rows per label). "
            "A row-wise lag inside one labelling interval repeats the current "
            "target value, so the model would be reading its own answer. "
            "Either resample the frame to the target's interval or set the lag "
            "to at least that many rows."
        )
    log(f"Leakage check passed: ~{rows_per_label:.1f} rows per labelled target")


def chronological_split(
    frame: pd.DataFrame, ratio: float
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Time-ordered split, plus the cut timestamp it actually landed on.

    Never random: the frame carries lag/rolling features, so a shuffled split
    puts future-derived rows in train and inflates every metric.

    The cut timestamp is RETURNED, not just the ratio, because a ratio
    resolves to a different boundary against a different row count — which is
    exactly what happens once non-Good target rows are dropped upstream of
    this call.
    """
    ordered = frame.sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)
    cut = int(len(ordered) * ratio)
    if cut < 1 or cut >= len(ordered):
        raise RuntimeError(
            f"Split ratio {ratio} leaves one side empty at {len(ordered)} "
            "labelled rows."
        )
    cut_timestamp = str(ordered.loc[cut, TIMESTAMP_COLUMN])
    return ordered.iloc[:cut], ordered.iloc[cut:], cut_timestamp


# MODEL-FLOW-009-T01/T02/T03. Sequence-model (lstm/gru) windowing pipeline.
#
# Pure pandas/numpy — no torch/tensorflow — deliberately kept usable and
# fully unit-tested (test_train.py) without either dependency, matching
# MODEL-FLOW-009's confirmed scope for this pass. NOT wired into main()
# below: build_model's lstm/gru branch still raises before any of this
# would run (the API/TrainingAlgorithmEnum already refuses lstm/gru before
# a container is ever spawned, so main()'s live 10-algorithm flow is
# untouched by this addition). MODEL-FLOW-009-T04 is where a real caller
# starts invoking these — once torch/tensorflow land in this image and the
# algorithm enum is unblocked, T04 rewires main()'s split/fit/predict
# block to call build_windows() before build_model() and to consume the
# 3-D output instead of the flat train/test frames it uses today.
#
# No forecast/lookback-window concept exists anywhere else in this
# codebase to anchor a target convention, so this is a NOWCAST, not a
# forecast: window i covers rows [i-sequence_length+1, i] and predicts the
# target AT row i (the window's own last timestep) — the same convention
# every other algorithm here already uses (features and target share a
# timestamp). This keeps predictions.parquet's {timestamp, y_true, y_pred}
# schema unchanged for a sequence algorithm; a next-step-ahead convention
# would have required changing that contract for no requested benefit.
DEFAULT_SEQUENCE_LENGTH = 24


def build_windows(
    frame: pd.DataFrame,
    target_y: str,
    feature_cols: list[str],
    sequence_length: int,
    label_mask: pd.Series,
) -> tuple[np.ndarray, np.ndarray, pd.Series]:
    """(samples, timesteps, features) windows, built over the FULL
    time-ordered frame — NOT the post-`labelled_mask` frame
    `chronological_split` receives.

    Why the full frame: consecutive rows in a `labelled`-only frame are
    NOT consecutive in wall-clock time (see the module docstring — a lab
    target sampled daily against a 1-minute grid is ~1,440 rows per
    label). Windowing over `labelled` at sequence_length=24 would
    silently span 24 DAYS of history, not 24 grid-steps, and
    `assert_no_target_leakage` would not catch it (it returns early when
    `derived` is empty — a dataset with no target-derived FEATURE column
    can have that same ~1,440 rows-per-label ratio and never trip it).
    Windowing over the full frame preserves the frame's true spacing;
    only a window's INCLUSION is gated by `label_mask`, checked on its
    target row (row i, the window's last row) — an unlabelled target row
    produces no window at all, not a padded or partial one, and neither
    does a target row without `sequence_length` rows of history behind it
    (no padding — dropped, same as an unlabelled one).

    `frame` MUST already be sorted by TIMESTAMP_COLUMN ascending with a
    reset index — this does not re-sort itself, so it fails loudly on a
    caller that forgot to rather than silently accepting a different
    order than `label_mask`'s own index assumes.

    Returns (X, y, target_timestamps): X is
    (n_windows, sequence_length, len(feature_cols)); y and
    target_timestamps are length n_windows, walking in the same ascending
    order as X's first axis.
    """
    if sequence_length < 1:
        raise RuntimeError(
            f"sequence_length must be >= 1, got {sequence_length}.")
    if not frame[TIMESTAMP_COLUMN].is_monotonic_increasing:
        raise RuntimeError(
            "build_windows requires frame sorted by TIMESTAMP_COLUMN ascending."
        )

    feature_matrix = frame[feature_cols].to_numpy(dtype=float)
    target_values = frame[target_y].to_numpy(dtype=float)
    timestamps = frame[TIMESTAMP_COLUMN]
    mask = label_mask.to_numpy()

    windows: list[np.ndarray] = []
    targets: list[float] = []
    target_ts: list[Any] = []
    for i in range(sequence_length - 1, len(frame)):
        if not mask[i]:
            continue
        windows.append(feature_matrix[i - sequence_length + 1: i + 1])
        targets.append(target_values[i])
        target_ts.append(timestamps.iloc[i])

    if not windows:
        return (
            np.empty((0, sequence_length, len(feature_cols))),
            np.empty((0,)),
            pd.Series(dtype="datetime64[ns]"),
        )

    return (
        np.stack(windows),
        np.array(targets),
        pd.Series(target_ts).reset_index(drop=True),
    )


def chronological_split_windows(
    window_timestamps: pd.Series, ratio: float
) -> tuple[np.ndarray, np.ndarray, str]:
    """`chronological_split`'s cut rule, for pre-built windows.

    `window_timestamps` must already be ascending — `build_windows` walks
    the frame in timestamp order and keeps only windows whose target row
    is labelled, so it is already in the order this needs; re-sorting
    here would silently accept a caller that mixed up window order
    instead of failing on it.

    Returns (train_idx, test_idx, cut_timestamp): integer positions into
    the windows array (and into `window_timestamps`/the paired y array),
    plus the cut timestamp itself for the run manifest — same shape as
    `chronological_split`'s own return, so callers can log/record it the
    same way.
    """
    n = len(window_timestamps)
    if n == 0:
        raise RuntimeError("No windows to split.")
    if not window_timestamps.is_monotonic_increasing:
        raise RuntimeError(
            "chronological_split_windows requires window_timestamps ascending."
        )
    cut = int(n * ratio)
    if cut < 1 or cut >= n:
        raise RuntimeError(
            f"Split ratio {ratio} leaves one side empty at {n} windows.")
    cut_timestamp = str(window_timestamps.iloc[cut])
    return np.arange(0, cut), np.arange(cut, n), cut_timestamp


def assert_no_window_leakage(
    window_timestamps: pd.Series, train_idx: np.ndarray, cut_timestamp: str
) -> None:
    """One assertion, not a new analysis: no train-assigned window's
    TARGET timestamp is at or after the split cut.

    Windows are keyed by their target row (`build_windows`), so a
    correctly-assigned train window's span [i-sequence_length+1, i] is
    always entirely before the cut BY CONSTRUCTION — a test window
    legitimately looking backward past the cut for history is normal
    forecaster lookback, not leakage, and this does not flag it. The
    real failure mode this guards against is an implementation mistake:
    assigning a window to train/test by its START index instead of its
    TARGET index, which can smuggle a post-cut label into training. That
    is the one thing checked here.
    """
    cut_ts = pd.Timestamp(cut_timestamp)
    train_targets = window_timestamps.iloc[train_idx]
    leaked = train_targets[train_targets >= cut_ts]
    if not leaked.empty:
        raise RuntimeError(
            f"{len(leaked)} train-assigned window(s) have a target "
            f"timestamp at or after the split cut ({cut_timestamp}) — "
            "windows were assigned by start index instead of target "
            "index. Every train window's target timestamp must be "
            "before the cut."
        )


def assert_no_nan_features(X: np.ndarray, context: str) -> None:
    """MODEL-FLOW-009-T04. A window's INCLUSION is gated on its target row's
    label (build_windows), never on the quality of the non-target rows
    inside its span — a window legitimately reaches back through unlabelled
    rows for feature history. But if a FEATURE is NaN on one of those
    in-window rows, torch trains on it silently: no exception, just NaN
    loss from that step forward, which is the exact "looks like success"
    failure class this trainer's module docstring is built around. Checked
    once, right after build_windows, rather than left to surface as an
    opaque NaN loss log line partway through fit().
    """
    if X.size == 0:
        return
    bad = np.isnan(X).any(axis=(1, 2))
    if bad.any():
        raise RuntimeError(
            f"{int(bad.sum())} {context} window(s) contain a NaN feature "
            "value on a non-target row within their span. A window's "
            "target row must be labelled Good, but its FEATURE rows are "
            "not filtered — resample or impute upstream so no feature is "
            "NaN across the full frame, not just on labelled rows."
        )


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

# MODEL-FLOW-013-T05. A run with many thousands of boosting iterations must
# not ship an unbounded loss-history array. Refused BY NAME — soft-skipped
# (no artifact, no placeholder, logged as a warning) rather than silently
# truncated or sampled, same discipline apps/python's MAX_PREDICTION_POINTS
# applies to a training run's other array-shaped artifact. Never fails the
# run: model.joblib/metrics.json are what matters, and this is best-effort
# alongside them. Deferred design for whoever hits this cap first: aggregate
# by evenly-spaced index rather than truncate from either end, so the SHAPE
# of a long run's curve stays visible instead of being cut off mid-descent.
MAX_LOSS_HISTORY_POINTS = 5_000


def extract_loss_history(algorithm: str, model: Any) -> dict[str, Any] | None:
    """Per-iteration loss trajectory for the algorithms that genuinely have
    one. Returns None for a closed-form algorithm (ols/ridge/pls/grp/svm/
    random_forest) — no artifact, no placeholder, per this feature's own
    instruction: a curve cannot be produced for these, not merely "has not
    been produced yet."

    `metric` names exactly what is plotted, never assumed comparable across
    algorithms: "rmse" for lightgbm/xgboost, because `main()` explicitly
    requests that eval_metric so it IS the same number metrics.json reports;
    "loss" for mlp/hist_gradient_boosting, whose native trajectory is in the
    estimator's own loss units — forcing an RMSE label on those would be
    false, the exact failure class this feature's findings name.
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
            # eval_set order in main() is [train, test] -> xgboost's own
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
                series["validation"] = [float(v) for v in model.validation_loss_]
            # MSELoss — the loss SequenceRegressor.fit actually minimizes —
            # not "rmse": the value plotted is the un-rooted mean squared
            # error, and labelling it rmse would repeat the exact
            # mismatched-unit failure this feature's own docstring warns
            # against for mlp/hist_gradient_boosting.
            metric = "loss"
        else:
            return None
    except Exception as exc:  # noqa: BLE001 - best-effort, must never fail the run
        log(f"loss history extraction failed for {algorithm}: {exc}", "warn")
        return None

    longest = max(len(s) for s in series.values())
    if longest > MAX_LOSS_HISTORY_POINTS:
        log(
            f"loss history for {algorithm} has {longest} points, over "
            f"MAX_LOSS_HISTORY_POINTS ({MAX_LOSS_HISTORY_POINTS}) — skipped, "
            "not truncated.",
            "warn",
        )
        return None

    return {"algorithm": algorithm, "metric": metric, "series": series}


def build_model(
    algorithm: str,
    hyperparameters: dict[str, Any],
    seed: int,
    n_train_rows: int,
    feature_spec: dict[str, Any],
):
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
        # — only the target's scaling is gated, above. SVR is the one
        # algorithm sensitive enough to unscaled inputs that its absence is
        # worth naming. Not fatal: the user may want to see exactly that
        # result.
        if not feature_spec.get("scaling"):
            log(
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
                "in train.py for how that number was measured). Use Random "
                "Forest, LightGBM, or XGBoost for a dataset this size, or "
                "shorten the training window."
            )
        return GaussianProcessRegressor(
            alpha=float(hyperparameters.get("alpha", 1e-10)),
            n_restarts_optimizer=int(hyperparameters.get("n_restarts_optimizer", 0)),
            random_state=seed,
        )
    if algorithm == "pls":
        # No manual clamp on n_components vs. feature count: sklearn already
        # raises a clear ValueError ("`n_components` upper bound is N")
        # which the top-level handler (main's __main__ guard) reports
        # verbatim as failureReason — as actionable as anything we'd write
        # here, so it is left to surface unmodified.
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
    if algorithm in ("lstm", "gru"):
        # MODEL-FLOW-009-T04. build_windows/chronological_split_windows have
        # already run by the time main() calls build_model — this branch
        # only constructs the estimator, same division of labour every other
        # branch here already has (build_model never sees the split itself).
        # n_train_rows is a WINDOW count here (main() passes len(train_idx)
        # for this algorithm, not a row count) — the same enforcement
        # discipline the grp branch above applies to GPR_MAX_TRAIN_ROWS.
        if n_train_rows > LSTM_MAX_TRAIN_WINDOWS:
            raise RuntimeError(
                f"{n_train_rows} training windows exceeds the measured "
                f"ceiling of {LSTM_MAX_TRAIN_WINDOWS} for this container's "
                "memory/CPU limits (see LSTM_MAX_TRAIN_WINDOWS in train.py "
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


def main() -> int:
    started = time.time()
    SCRATCH.mkdir(parents=True, exist_ok=True)

    # ── 1. run spec ──────────────────────────────────────────────────────
    spec = SESSION.post(f"{API}/claim", timeout=60)
    spec.raise_for_status()
    spec = spec.json()
    log(f"Claimed run: target={spec['targetY']} algo={spec['algorithm']}")

    # ── 2. download (in full, before any read) ───────────────────────────
    data_path = download(spec["dataUrl"], SCRATCH / "data.parquet")
    feature_spec: dict[str, Any] = {}
    if spec.get("featureSpecUrl"):
        feature_spec = json.loads(
            download(spec["featureSpecUrl"], SCRATCH /
                     "feature_spec.json").read_text()
        )

    # ── 3. verify ────────────────────────────────────────────────────────
    actual = sha256_of(data_path)
    if actual != spec["artifactChecksum"]:
        raise RuntimeError(
            f"Checksum mismatch: expected {spec['artifactChecksum']}, got {actual}. "
            "The bytes are not the artifact this run was created against."
        )
    log("Checksum verified")

    # ── 4. read the spec's own account of the target ─────────────────────
    target_y = spec["targetY"]
    if feature_spec.get("target_y") and feature_spec["target_y"] != target_y:
        raise RuntimeError(
            f"Run targets '{target_y}' but feature_spec.json says "
            f"'{feature_spec['target_y']}'."
        )
    # An absent field is NOT read as False. The writer emits `target_scaled`
    # explicitly precisely so "not scaled" and "not recorded" stay distinct.
    if "target_scaled" in feature_spec and feature_spec["target_scaled"]:
        raise RuntimeError(
            f"'{target_y}' is stored scaled and no inverse transform is "
            "recorded — predictions could not be returned in engineering units."
        )
    derived = list(feature_spec.get("derived_from_target", []))

    frame = pd.read_parquet(data_path)
    if target_y not in frame.columns:
        raise RuntimeError(f"'{target_y}' is not a column in the artifact.")

    # ── 5. X / y ─────────────────────────────────────────────────────────
    # Status columns are quality metadata, not signal — leaving them in would
    # let the model learn from the shape of missingness.
    status_cols = [c for c in frame.columns if c.endswith(STATUS_SUFFIX)]
    feature_cols = [
        c
        for c in frame.columns
        if c not in (TIMESTAMP_COLUMN, target_y) and c not in status_cols
    ]
    if not feature_cols:
        raise RuntimeError(
            "No feature columns left after removing the target.")

    # ── 6-7. drop non-Good target, BEFORE any split ──────────────────────
    label_mask = labelled_mask(frame, target_y, log_fn=log)

    assert_no_target_leakage(frame, target_y, derived, label_mask)

    is_sequence = spec["algorithm"] in ("lstm", "gru")

    # MODEL-FLOW-009-T04. Sequence models window over the FULL time-ordered
    # frame, never the `labelled`-only frame the tabular branch below
    # builds — build_windows' own docstring (and its regression test) is
    # why: consecutive rows in `labelled` are not consecutive in wall-clock
    # time, so windowing over it would silently span the wrong duration.
    # Every other algorithm's path (the `else`) is byte-for-byte unchanged
    # from before this task.
    if is_sequence:
        sequence_length = int(
            (spec.get("hyperparameters") or {}).get(
                "sequence_length", DEFAULT_SEQUENCE_LENGTH)
        )
        ordered_frame = frame.sort_values(
            TIMESTAMP_COLUMN).reset_index(drop=True)
        ordered_label_mask = labelled_mask(ordered_frame, target_y, log_fn=log)
        X, y, window_ts = build_windows(
            ordered_frame, target_y, feature_cols, sequence_length, ordered_label_mask
        )
        log(
            f"{len(y)} windows of {len(ordered_frame)} rows "
            f"(sequence_length={sequence_length})"
        )
        if len(y) < 30:
            raise RuntimeError(
                f"Only {len(y)} windows have a Good target — too few to "
                f"split. The artifact has {len(frame)} rows; try a shorter "
                "sequence_length or aggregating to the target's interval."
            )
        assert_no_nan_features(X, "training")
    else:
        labelled = frame.loc[label_mask].reset_index(drop=True)
        log(
            f"{len(labelled)} labelled rows of {len(frame)} "
            f"({100 * len(labelled) / max(len(frame), 1):.2f}%)"
        )
        if len(labelled) < 30:
            raise RuntimeError(
                f"Only {len(labelled)} rows have a Good target — too few to split. "
                f"The artifact has {len(frame)} rows, so the target is far sparser "
                "than the grid; consider aggregating to the target's interval."
            )

    # ── 8. split ─────────────────────────────────────────────────────────
    ratio = float(spec["splitSpec"].get("ratio", 0.8))
    if is_sequence:
        train_idx, test_idx, cut_timestamp = chronological_split_windows(
            window_ts, ratio)
        assert_no_window_leakage(window_ts, train_idx, cut_timestamp)
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        ts_test = window_ts.iloc[test_idx]
        split_spec = {
            "method": "chronological_windowed",
            "ratio": ratio,
            "cut_timestamp": cut_timestamp,
            "sequence_length": sequence_length,
            # WINDOW counts, not row counts — unlike every other
            # algorithm's train_rows/test_rows below, which genuinely are
            # row counts. Stated here so a future reader of a saved
            # manifest does not assume uniformity across all 11 algorithms.
            "train_rows": int(len(train_idx)),
            "test_rows": int(len(test_idx)),
            "source_rows": int(len(frame)),
            "labelled_rows": int(len(y)),
        }
        log(
            f"Split at {cut_timestamp}: {len(train_idx)} train / "
            f"{len(test_idx)} test windows"
        )
    else:
        train, test, cut_timestamp = chronological_split(labelled, ratio)
        split_spec = {
            "method": "chronological",
            "ratio": ratio,
            "cut_timestamp": cut_timestamp,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            # The pre-drop count, kept alongside so the sparsity is visible in the
            # record rather than only in a log line.
            "source_rows": int(len(frame)),
            "labelled_rows": int(len(labelled)),
        }
        log(f"Split at {cut_timestamp}: {len(train)} train / {len(test)} test")

    # ── 9. fit, score, write ─────────────────────────────────────────────
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    model = build_model(
        spec["algorithm"],
        spec.get("hyperparameters") or {},
        spec["seed"],
        len(train_idx) if is_sequence else len(train),
        feature_spec,
    )
    # MODEL-FLOW-013-T05. eval_set is passed ONLY to RECORD a loss
    # trajectory (extract_loss_history, above) — no early_stopping_rounds
    # anywhere, so this never changes when training stops or what the
    # fitted model is, for any algorithm. Every other algorithm's fit call
    # is untouched.
    if spec["algorithm"] == "lightgbm":
        model.fit(
            train[feature_cols],
            train[target_y],
            eval_set=[
                (train[feature_cols], train[target_y]),
                (test[feature_cols], test[target_y]),
            ],
            eval_names=["train", "validation"],
            eval_metric="rmse",
        )
    elif spec["algorithm"] == "xgboost":
        # eval_metric lives on the constructor for xgboost (see build_model)
        # — only eval_set belongs here.
        model.fit(
            train[feature_cols],
            train[target_y],
            eval_set=[
                (train[feature_cols], train[target_y]),
                (test[feature_cols], test[target_y]),
            ],
            verbose=False,
        )
    elif is_sequence:
        # MODEL-FLOW-009-T04. Same eval_set-for-loss-history-only contract
        # as lightgbm/xgboost above — SequenceRegressor.fit never uses it
        # for early stopping either.
        model.fit(X_train, y_train, eval_set=[
                  (X_train, y_train), (X_test, y_test)])
    else:
        model.fit(train[feature_cols], train[target_y])

    if is_sequence:
        predicted = model.predict(X_test)
        predicted_train = model.predict(X_train)
        y_test_values = y_test
        y_train_values = y_train
        metric_train_rows = int(len(train_idx))
        metric_test_rows = int(len(test_idx))
    else:
        predicted = model.predict(test[feature_cols])
        predicted_train = model.predict(train[feature_cols])
        y_test_values = test[target_y]
        y_train_values = train[target_y]
        metric_train_rows = int(len(train))
        metric_test_rows = int(len(test))

    metrics = {
        "r2": float(r2_score(y_test_values, predicted)),
        "mae": float(mean_absolute_error(y_test_values, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(y_test_values, predicted))),
        # MODEL-FLOW-013-T04. Named train_* so nothing later mistakes these
        # for holdout figures, which are a distinct object with their own
        # currently-always-null metrics (see 9b below) — MODEL-FLOW-004
        # already had to rename a heading for exactly that confusion.
        "train_r2": float(r2_score(y_train_values, predicted_train)),
        "train_mae": float(mean_absolute_error(y_train_values, predicted_train)),
        "train_rmse": float(np.sqrt(mean_squared_error(y_train_values, predicted_train))),
        # WINDOW counts for lstm/gru, row counts for every other algorithm
        # — see split_spec's own "train_rows"/"test_rows" comment above.
        "train_rows": metric_train_rows,
        "test_rows": metric_test_rows,
        "feature_count": len(feature_cols),
    }
    log(f"r2={metrics['r2']:.4f} mae={metrics['mae']:.4f} rmse={metrics['rmse']:.4f}")

    # MODEL-FLOW-013-T05a. Written unconditionally here (None for a
    # closed-form algorithm) — the CLIENT decides render mode from whether
    # a run has a lossHistoryKey, never from a switch on the algorithm name.
    loss_history = extract_loss_history(spec["algorithm"], model)

    # ── 9b. score the raw validation holdout, BESIDE the test metrics ──────
    # DS-LAKE-018-T05. `holdoutDataUrl` is present only when the dataset has
    # one AND claim()'s replay succeeded — absent for the overwhelming
    # majority of runs (no holdout) exactly like today. A holdout problem
    # must never fail an otherwise-successful run, so this whole step is
    # best-effort: any exception here is logged and swallowed, same
    # soft-fail contract claim() itself already applies to the replay.
    holdout_metrics: dict[str, Any] | None = None
    if spec.get("holdoutDataUrl"):
        try:
            holdout_path = download(
                spec["holdoutDataUrl"], SCRATCH / "holdout.parquet")
            holdout_checksum = sha256_of(holdout_path)
            if holdout_checksum != spec["holdoutArtifactChecksum"]:
                raise RuntimeError(
                    f"Holdout checksum mismatch: expected "
                    f"{spec['holdoutArtifactChecksum']}, got {holdout_checksum}."
                )
            holdout_df = pd.read_parquet(holdout_path)
            missing_cols = [c for c in feature_cols if c not in holdout_df.columns]
            if missing_cols:
                raise RuntimeError(
                    f"Replayed holdout is missing feature column(s) "
                    f"{missing_cols} the model was trained on."
                )
            if target_y not in holdout_df.columns:
                raise RuntimeError(
                    f"Replayed holdout has no '{target_y}' column to score against.")

            # DS-LAKE-023-T03/D4. Nothing dropped an unlabelled holdout row
            # before this fix — for a lab target sampled far sparser than
            # the PI grid, most of the holdout window has no target value,
            # `r2_score` raises on the resulting NaNs, and the surrounding
            # `except Exception` swallowed it silently. Same mask steps 6-7
            # already apply to train/test, applied here too so the two
            # scores are comparable (both computed over labelled rows only).
            holdout_source_rows = len(holdout_df)

            if is_sequence:
                # MODEL-FLOW-009-T04. Same build_windows call training uses
                # — full time-ordered frame, target-row gated — applied to
                # the holdout so its scoring is not silently skipped for
                # lstm/gru (the existing best-effort except below would
                # otherwise swallow a plain shape mismatch with no signal
                # that this algorithm's holdout scoring never works at all).
                holdout_ordered = holdout_df.sort_values(
                    TIMESTAMP_COLUMN).reset_index(drop=True)
                holdout_label_mask = labelled_mask(
                    holdout_ordered, target_y, log_fn=log)
                Xh, yh, _ = build_windows(
                    holdout_ordered, target_y, feature_cols, sequence_length,
                    holdout_label_mask,
                )
                # Rows NOT reaching a window at all (unlabelled target OR
                # too little history before it) — a broader count than the
                # tabular branch's dropped_unlabelled below; named the same
                # key deliberately (both answer "how much of the holdout
                # produced nothing"), documented as broader rather than
                # silently redefined.
                dropped_unlabelled = int(holdout_source_rows - len(yh))
                if len(yh) == 0:
                    raise RuntimeError(
                        f"Holdout produced no labelled windows out of "
                        f"{holdout_source_rows} rows (sequence_length="
                        f"{sequence_length}) — nothing to score."
                    )
                assert_no_nan_features(Xh, "holdout")
                holdout_predicted = model.predict(Xh)
                holdout_y = yh
                holdout_row_count = int(len(yh))
            else:
                holdout_labelled = labelled_mask(holdout_df, target_y, log_fn=log)
                dropped_unlabelled = int((~holdout_labelled).sum())
                holdout_df = holdout_df.loc[holdout_labelled].reset_index(
                    drop=True)
                if len(holdout_df) == 0:
                    raise RuntimeError(
                        f"Holdout has no labelled '{target_y}' rows after "
                        f"excluding {dropped_unlabelled} unlabelled row(s) of "
                        f"{holdout_source_rows} — nothing to score."
                    )
                holdout_predicted = model.predict(holdout_df[feature_cols])
                holdout_y = holdout_df[target_y]
                holdout_row_count = int(len(holdout_df))

            # DS-LAKE-023-T05. Rows already dropped server-side (`prepare_
            # holdout_for_run`'s own `drop_bad_feature_rows`, BEFORE it
            # scaled the holdout) — this container never sees those rows at
            # all, so there is nothing to re-derive here; `claim()`'s own
            # response is the only place this count is known. None for a
            # legacy (BRONZE/replay) holdout, which does not run that
            # exclusion.
            dropped_bad_features = spec.get("holdoutDroppedBadRows")
            holdout_metrics = {
                "r2": float(r2_score(holdout_y, holdout_predicted)),
                "mae": float(mean_absolute_error(holdout_y, holdout_predicted)),
                "rmse": float(np.sqrt(mean_squared_error(holdout_y, holdout_predicted))),
                # A WINDOW count for lstm/gru, a row count for every other
                # algorithm — same distinction split_spec's train_rows/
                # test_rows already documents.
                "row_count": holdout_row_count,
                # Reported beside the metrics, not just logged — a score
                # computed over an unstated subset is not comparable to
                # anything (same reasoning MODEL-FLOW-010-T06 and
                # DS-LAKE-018 already apply to the holdout's missing rate).
                "dropped_unlabelled": dropped_unlabelled,
                "dropped_bad_features": dropped_bad_features,
            }
            log(
                f"holdout: r2={holdout_metrics['r2']:.4f} "
                f"mae={holdout_metrics['mae']:.4f} rmse={holdout_metrics['rmse']:.4f} "
                f"({holdout_metrics['row_count']} rows, "
                f"{dropped_unlabelled} unlabelled dropped, "
                f"{dropped_bad_features} bad-feature dropped) — "
                f"test r2 was {metrics['r2']:.4f}"
            )
        except Exception as exc:  # noqa: BLE001 - best-effort, see docstring above
            log(f"Holdout scoring skipped: {exc}", "warn")
            holdout_metrics = None

    import joblib

    model_path = SCRATCH / "model.joblib"
    joblib.dump(model, model_path)

    predictions_path = SCRATCH / "predictions.parquet"
    if is_sequence:
        # MODEL-FLOW-009-T04. ts_test/y_test are the EXACT paired arrays
        # test_idx indexes into — never re-derived from `labelled`, which
        # does not exist in this branch and would be off by window count
        # relative to row count even if it did.
        pd.DataFrame(
            {
                TIMESTAMP_COLUMN: ts_test.values,
                "y_true": y_test,
                "y_pred": predicted,
            }
        ).to_parquet(predictions_path, index=False)
    else:
        pd.DataFrame(
            {
                TIMESTAMP_COLUMN: test[TIMESTAMP_COLUMN].values,
                "y_true": test[target_y].values,
                "y_pred": predicted,
            }
        ).to_parquet(predictions_path, index=False)

    # MODEL-FLOW-007-T11. Recorded at the one moment full training context is
    # in scope — a serving process opening this object months later has only
    # what is written down here. A joblib pickled by one sklearn version and
    # unpickled by a different one can load with a warning and predict
    # subtly differently: the same class of failure as MODEL-FLOW-000-T02,
    # it LOOKS LIKE SUCCESS. sklearn is always present (scalers/preprocessing
    # run through it regardless of the final estimator); lightgbm/xgboost are
    # re-imported here rather than threaded out of build_model's own local
    # import — both are already in sys.modules by this point for a run that
    # used them, so this is a dict lookup, not a second real import.
    algorithm = spec["algorithm"]
    framework_versions: dict[str, str] = {"sklearn": sklearn.__version__}
    if algorithm == "lightgbm":
        import lightgbm

        framework_versions["lightgbm"] = lightgbm.__version__
    elif algorithm == "xgboost":
        import xgboost

        framework_versions["xgboost"] = xgboost.__version__
    elif algorithm in ("lstm", "gru"):
        import torch

        framework_versions["torch"] = torch.__version__

    # Self-describing, for the same reason build_manifest exists: this run
    # must be interpretable from object storage without Postgres.
    manifest = {
        "run_id": RUN_ID,
        "gold_object_key": spec["goldObjectKey"],
        "artifact_checksum": actual,
        "image_digest": spec["imageDigest"],
        "target_y": target_y,
        "target_scaled": bool(feature_spec.get("target_scaled", False)),
        "derived_from_target": derived,
        "feature_columns": feature_cols,
        "algorithm": spec["algorithm"],
        "hyperparameters": spec.get("hyperparameters") or {},
        "seed": spec["seed"],
        "split": split_spec,
        "metrics": metrics,
        # DS-LAKE-018-T05. None whenever there was no holdout, or scoring it
        # failed — see the best-effort block above. Deliberately a SEPARATE
        # key, never merged into "metrics".
        "holdout_metrics": holdout_metrics,
        # So a deployed binary can be proven to be this run's output.
        "model_sha256": sha256_of(model_path),
        "duration_ms": int((time.time() - started) * 1000),
        "framework_versions": framework_versions,
    }
    manifest_path = SCRATCH / "run_manifest.json"
    manifest_path.write_text(json.dumps(
        manifest, indent=2, sort_keys=True, default=str))

    outputs = {
        "model.joblib": (model_path, "application/octet-stream"),
        "metrics.json": (SCRATCH / "metrics.json", "application/json"),
        "run_manifest.json": (manifest_path, "application/json"),
        "predictions.parquet": (predictions_path, "application/vnd.apache.parquet"),
    }
    (SCRATCH / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True))

    # MODEL-FLOW-013-T05. Only added to `outputs` when a series was actually
    # extracted — an estimator with no iterations (or one that exceeded
    # MAX_LOSS_HISTORY_POINTS) writes no artifact and no placeholder.
    if loss_history is not None:
        loss_history_path = SCRATCH / "loss_history.json"
        loss_history_path.write_text(
            json.dumps(loss_history, indent=2, sort_keys=True)
        )
        outputs["loss_history.json"] = (loss_history_path, "application/json")

    # Write URLs are requested HERE, not at claim time — the fit may have
    # taken hours, and a capability minted to survive that would be far
    # longer-lived than it needs to be.
    minted = SESSION.post(
        f"{API}/upload-urls", json={"filenames": list(outputs)}, timeout=60
    )
    minted.raise_for_status()
    upload_urls = minted.json()["upload_urls"]

    uploaded: list[str] = []
    for filename, (path, content_type) in outputs.items():
        with path.open("rb") as handle:
            response = requests.put(
                upload_urls[filename],
                data=handle,
                headers={"Content-Type": content_type},
                timeout=600,
            )
        response.raise_for_status()
        uploaded.append(filename)
    log(f"Uploaded {len(uploaded)} objects")

    SESSION.post(
        f"{API}/complete",
        json={
            "status": "SUCCEEDED",
            "metrics": metrics,
            **({"holdoutMetrics": holdout_metrics} if holdout_metrics else {}),
            "splitSpec": split_spec,
            "uploaded": uploaded,
        },
        timeout=60,
    ).raise_for_status()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001
        # Report before dying. The runner's exit-code watcher is a backstop for
        # the case where even this fails (OOM kill, segfault) — it produces a
        # far less useful message, so getting here matters.
        log(str(err), "error")
        try:
            SESSION.post(
                f"{API}/complete",
                json={"status": "FAILED", "failureReason": str(err)[:2000]},
                timeout=30,
            )
        except requests.RequestException:
            pass
        sys.exit(1)
