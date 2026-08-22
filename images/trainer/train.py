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

        return xgboost.XGBRegressor(
            n_estimators=int(hyperparameters.get("n_estimators", 100)),
            learning_rate=float(hyperparameters.get("learning_rate", 0.1)),
            max_depth=int(hyperparameters.get("max_depth", 6)),
            random_state=seed,
        )
    if algorithm in ("lstm", "gru"):
        # Backstop only: the API rejects lstm/gru before a container is ever
        # spawned (TrainingAlgorithmEnum) and the wizard disables both
        # options inline — this branch exists for a caller that bypasses
        # the API. Deferred, not unsupported-by-omission: it needs a
        # windowed (samples, timesteps, features) input built BEFORE the
        # chronological split (a pipeline change, not a build_model
        # branch), a sequence_length hyperparameter this trainer does not
        # collect, and tensorflow or torch in this image — none of which
        # exist yet. Tracked separately from this catalogue extension.
        raise RuntimeError(
            f"'{algorithm}' is not implemented: it needs a windowed "
            "(samples, timesteps, features) input, a sequence_length "
            "hyperparameter, and tensorflow/torch in this image, none of "
            "which exist yet. Pick a tabular algorithm instead — Random "
            "Forest, LightGBM, or XGBoost are strong defaults for "
            "time-ordered plant data."
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
    target_status = status_column(target_y)
    if target_status in frame.columns:
        label_mask = frame[target_status] == STATUS_GOOD
    else:
        # No sidecar (a legacy or hand-built artifact) — fall back to
        # non-null, and say so rather than silently treating every row as
        # labelled.
        log(f"'{target_status}' absent — falling back to non-null target", "warn")
        label_mask = frame[target_y].notna()
    label_mask = label_mask & frame[target_y].notna()

    assert_no_target_leakage(frame, target_y, derived, label_mask)

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
        len(train),
        feature_spec,
    )
    model.fit(train[feature_cols], train[target_y])
    predicted = model.predict(test[feature_cols])

    metrics = {
        "r2": float(r2_score(test[target_y], predicted)),
        "mae": float(mean_absolute_error(test[target_y], predicted)),
        "rmse": float(np.sqrt(mean_squared_error(test[target_y], predicted))),
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "feature_count": len(feature_cols),
    }
    log(f"r2={metrics['r2']:.4f} mae={metrics['mae']:.4f} rmse={metrics['rmse']:.4f}")

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

            holdout_predicted = model.predict(holdout_df[feature_cols])
            holdout_metrics = {
                "r2": float(r2_score(holdout_df[target_y], holdout_predicted)),
                "mae": float(mean_absolute_error(holdout_df[target_y], holdout_predicted)),
                "rmse": float(np.sqrt(mean_squared_error(holdout_df[target_y], holdout_predicted))),
                "row_count": int(len(holdout_df)),
            }
            log(
                f"holdout: r2={holdout_metrics['r2']:.4f} "
                f"mae={holdout_metrics['mae']:.4f} rmse={holdout_metrics['rmse']:.4f} "
                f"({holdout_metrics['row_count']} rows) — test r2 was {metrics['r2']:.4f}"
            )
        except Exception as exc:  # noqa: BLE001 - best-effort, see docstring above
            log(f"Holdout scoring skipped: {exc}", "warn")
            holdout_metrics = None

    import joblib

    model_path = SCRATCH / "model.joblib"
    joblib.dump(model, model_path)

    predictions_path = SCRATCH / "predictions.parquet"
    pd.DataFrame(
        {
            TIMESTAMP_COLUMN: test[TIMESTAMP_COLUMN].values,
            "y_true": test[target_y].values,
            "y_pred": predicted,
        }
    ).to_parquet(predictions_path, index=False)

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
