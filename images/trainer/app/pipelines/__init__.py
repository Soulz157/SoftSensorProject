"""Training. One run, one target, one exit.

Reads the GOLD artifact over a presigned URL — this process never holds S3
credentials, matching the rule the connector service states on itself. It talks
to exactly two hosts: the internal API (for its spec and its result) and object
storage (for bytes).

THE STEP ORDER BELOW IS NOT COSMETIC, AND IT IS THE REASON THIS FUNCTION EXISTS
RATHER THAN THREE SELF-CONTAINED STRATEGY MODULES. Steps 6-7 (drop non-Good
target) must precede step 8 (split), because a lab target sampled daily against
a 1-minute PI grid has orders of magnitude fewer labels than rows: splitting
first yields a "20,000-row test set" holding a dozen labels, and every number
reported off it is meaningless while looking entirely plausible. That ordering is
enforced HERE, once, for all three strategies — a strategy receives a
`PreparedRun` in which steps 1-7 have already happened and cannot reorder them.

    1. claim the run spec
    2. download the artifact (in full, before any read)
    3. verify its checksum
    4. read the spec's own account of the target
    5. select X / y columns
    6-7. drop non-Good target rows, and refuse unusable target-derived features
    8-9. STRATEGY: split, fit, score        <- chronological / windowed / cv
    9b. score the raw validation holdout, beside the test metrics
    10. write artifacts, upload, complete
"""

from __future__ import annotations

import json
import time
from typing import Any

import pandas as pd

from api import RunApi
from artifacts import (
    ArtifactSet,
    LOSS_HISTORY_FILENAME,
    MANIFEST_FILENAME,
    METRICS_FILENAME,
    MODEL_FILENAME,
    PREDICTIONS_FILENAME,
)
from config import SCRATCH, STATUS_SUFFIX, TIMESTAMP_COLUMN, RunContext
from guards import assert_no_target_leakage
from holdout import score_holdout
from labels import labelled_mask
from manifest import build_run_manifest
from models import SEQUENCE_ALGORITHMS
from pipelines import chronological, cv_expanding, windowed
from pipelines.context import PreparedRun, TrainingResult
from storage import download, download_verified, sha256_of, upload_artifacts


def run_training(context: RunContext, api: RunApi) -> int:
    started = time.time()
    SCRATCH.mkdir(parents=True, exist_ok=True)

    prepared = _prepare(api)
    strategy = _select_strategy(prepared, api)
    result = strategy(prepared, api)
    holdout_metrics = _score_holdout_if_present(prepared, result, api)
    _publish(context, api, prepared, result, holdout_metrics, started)
    return 0


# ── 1-7. shared preamble ─────────────────────────────────────────────────────
def _prepare(api: RunApi) -> PreparedRun:
    # ── 1. run spec ──────────────────────────────────────────────────────
    spec = api.claim()
    api.log(f"Claimed run: target={spec['targetY']} algo={spec['algorithm']}")

    # ── 2-3. download (in full, before any read), then verify ────────────
    data_path, artifact_checksum = download_verified(
        spec["dataUrl"], SCRATCH /
        "data.parquet", spec["artifactChecksum"], "Artifact"
    )
    api.log("Checksum verified")

    feature_spec: dict[str, Any] = {}
    if spec.get("featureSpecUrl"):
        feature_spec = json.loads(
            download(
                spec["featureSpecUrl"], SCRATCH / "feature_spec.json"
            ).read_text()
        )

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
    label_mask = labelled_mask(frame, target_y, log_fn=api.log)
    assert_no_target_leakage(
        frame, target_y, derived, label_mask, log_fn=api.log)

    return PreparedRun(
        spec=spec,
        frame=frame,
        feature_spec=feature_spec,
        target_y=target_y,
        feature_cols=feature_cols,
        label_mask=label_mask,
        derived=derived,
        artifact_checksum=artifact_checksum,
    )


def _select_strategy(prepared: PreparedRun, api: RunApi):
    """Pick exactly one strategy, and refuse the one combination that has no
    implementation rather than silently degrading to another."""
    is_sequence = prepared.algorithm in SEQUENCE_ALGORITHMS
    is_cv = prepared.spec["splitSpec"].get("method") == "cv_expanding"

    # MODEL-FLOW-016-T01(c)/T03. CV is TABULAR ONLY — the same scope
    # /split-stats' own panel declares (that endpoint's docstring), inherited
    # here rather than decided twice. Refused before any fold fits, not merely
    # disabled in the wizard: MODEL-FLOW-014's own SeedControl-style UI disable
    # is one layer; this is the fit-time backstop underneath it.
    if is_cv and is_sequence:
        raise RuntimeError(
            "Cross-validation is tabular-only: lstm/gru cut on WINDOW count "
            "via chronological_split_windows, a different rule this CV path "
            "does not implement. See MODEL-FLOW-016-T01(c)."
        )

    if is_cv:
        return cv_expanding.run
    if is_sequence:
        return windowed.run
    return chronological.run


# ── 9b. holdout, beside the test metrics ─────────────────────────────────────
def _score_holdout_if_present(
    prepared: PreparedRun, result: TrainingResult, api: RunApi
) -> dict[str, Any] | None:
    """DS-LAKE-018-T05. `holdoutDataUrl` is present only when the dataset has
    one AND claim()'s replay succeeded — absent for the overwhelming majority of
    runs (no holdout). A holdout problem must never fail an otherwise-successful
    run, so this whole step is best-effort: any exception here is logged and
    swallowed, the same soft-fail contract claim() itself already applies to the
    replay.
    """
    if not prepared.spec.get("holdoutDataUrl") or not result.holdout_eligible:
        return None

    try:
        holdout_path, _ = download_verified(
            prepared.spec["holdoutDataUrl"],
            SCRATCH / "holdout.parquet",
            prepared.spec["holdoutArtifactChecksum"],
            "Holdout",
        )
        holdout_metrics, _ = score_holdout(
            result.model,
            pd.read_parquet(holdout_path),
            prepared.target_y,
            prepared.feature_cols,
            dropped_bad_features=prepared.spec.get("holdoutDroppedBadRows"),
            sequence_length=result.holdout_sequence_length,
            log_fn=api.log,
        )
        api.log(f"holdout r2={holdout_metrics['r2']:.4f} — "
                f"test r2 was {result.metrics['r2']:.4f}")
        return holdout_metrics
    except Exception as exc:  # noqa: BLE001 - best-effort, see docstring above
        api.log(f"Holdout scoring skipped: {exc}", "warn")
        return None


# ── 10. write, upload, complete ──────────────────────────────────────────────
def _publish(
    context: RunContext,
    api: RunApi,
    prepared: PreparedRun,
    result: TrainingResult,
    holdout_metrics: dict[str, Any] | None,
    started: float,
) -> None:
    import joblib

    artifacts = ArtifactSet(SCRATCH)

    model_path = SCRATCH / MODEL_FILENAME
    joblib.dump(result.model, model_path)
    artifacts.add_existing(MODEL_FILENAME, model_path)

    artifacts.add_json(METRICS_FILENAME, result.metrics)

    if result.predictions is not None:
        artifacts.add_parquet(PREDICTIONS_FILENAME, result.predictions)

    # Written only when a series was actually extracted — an estimator with no
    # iterations (or one that exceeded MAX_LOSS_HISTORY_POINTS) gets no artifact
    # and no placeholder.
    if result.loss_history is not None:
        artifacts.add_json(LOSS_HISTORY_FILENAME, result.loss_history)

    for filename, payload in result.extra_json.items():
        artifacts.add_json(filename, payload)

    artifacts.add_json(
        MANIFEST_FILENAME,
        build_run_manifest(
            run_id=context.run_id,
            spec=prepared.spec,
            artifact_checksum=prepared.artifact_checksum,
            target_y=prepared.target_y,
            feature_spec=prepared.feature_spec,
            derived=prepared.derived,
            feature_cols=prepared.feature_cols,
            split_spec=result.split_spec,
            metrics=result.metrics,
            holdout_metrics=holdout_metrics,
            model_path=model_path,
            duration_ms=int((time.time() - started) * 1000),
        ),
    )

    uploaded = upload_artifacts(api, artifacts.as_outputs(), log_fn=api.log)

    api.complete(
        {
            "status": "SUCCEEDED",
            "metrics": result.metrics,
            **({"holdoutMetrics": holdout_metrics} if holdout_metrics else {}),
            "splitSpec": result.split_spec,
            "uploaded": uploaded,
        }
    )


__all__ = ["run_training", "sha256_of"]
