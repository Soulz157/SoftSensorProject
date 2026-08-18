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
    """
    with SESSION.get(url, stream=True, timeout=300) as response:
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


def build_model(algorithm: str, hyperparameters: dict[str, Any], seed: int):
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.linear_model import LinearRegression, Ridge

    if algorithm in ("hgb", "hist_gradient_boosting"):
        return HistGradientBoostingRegressor(
            learning_rate=float(hyperparameters.get("learning_rate", 0.1)),
            max_iter=int(hyperparameters.get("n_estimators", 200)),
            max_leaf_nodes=int(hyperparameters.get("num_leaves", 31)),
            random_state=seed,
        )
    if algorithm == "ridge":
        return Ridge(alpha=float(hyperparameters.get("alpha", 1.0)), random_state=seed)
    if algorithm == "ols":
        return LinearRegression()
    raise RuntimeError(f"Unsupported algorithm '{algorithm}'.")


def build_feature_spec(
    features, selected_columns, scalers,
    target_y: str | None = None,
) -> dict[str, Any]:
    # `target_y` and the two fields derived from it are NOT part of the
    # hash: they describe how a downstream RUN reads this artifact, not how
    # the artifact was built. Two runs with different targets against the
    # same GOLD bytes must still share a featureHash.
    #
    # `derived_from_target` is what `train.py::assert_no_target_leakage`
    # gates on — an empty list there means "no target-derived features",
    # NOT "unknown", so it must be computed here rather than omitted.
    spec = {...}
    if target_y is not None:
        spec["target_y"] = target_y
        # Explicit False, not omitted: train.py distinguishes "recorded as
        # unscaled" from "never recorded".
        spec["target_scaled"] = scalers.get(target_y, "none") != "none"
        spec["derived_from_target"] = [
            cfg.get("name") or feature_column_name(cfg)
            for cfg in features
            if _reads_tag(cfg, target_y)
        ]
    return spec


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

    model = build_model(spec["algorithm"], spec.get(
        "hyperparameters") or {}, spec["seed"])
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
        "target_scaled": False,
        "derived_from_target": derived,
        "feature_columns": feature_cols,
        "algorithm": spec["algorithm"],
        "hyperparameters": spec.get("hyperparameters") or {},
        "seed": spec["seed"],
        "split": split_spec,
        "metrics": metrics,
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
