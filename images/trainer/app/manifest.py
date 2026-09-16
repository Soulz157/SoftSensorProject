"""run_manifest.json — this run, interpretable from object storage without
Postgres.

MODEL-FLOW-007-T11. `import sklearn` is module-level here, NOT a local import
per branch the way models.py's estimator imports are: every run goes through
sklearn regardless of the final estimator (scalers/preprocessing), so its version
belongs in every manifest, not just the algorithms that import it inside
build_model.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import sklearn

from storage import sha256_of


def framework_versions(algorithm: str) -> dict[str, str]:
    """Recorded at the one moment full training context is in scope — a serving
    process opening this object months later has only what is written down here.
    A joblib pickled by one sklearn version and unpickled by a different one can
    load with a warning and predict subtly differently: the same class of failure
    as MODEL-FLOW-000-T02, it LOOKS LIKE SUCCESS.

    lightgbm/xgboost/torch are re-imported here rather than threaded out of
    build_model's own local import — each is already in sys.modules by this point
    for a run that used it, so this is a dict lookup, not a second real import.
    """
    versions: dict[str, str] = {"sklearn": sklearn.__version__}
    if algorithm == "lightgbm":
        import lightgbm

        versions["lightgbm"] = lightgbm.__version__
    elif algorithm == "xgboost":
        import xgboost

        versions["xgboost"] = xgboost.__version__
    elif algorithm in ("lstm", "gru"):
        import torch

        versions["torch"] = torch.__version__
    return versions


def build_run_manifest(
    *,
    run_id: str,
    spec: dict[str, Any],
    artifact_checksum: str,
    target_y: str,
    feature_spec: dict[str, Any],
    derived: list[str],
    feature_cols: list[str],
    split_spec: dict[str, Any],
    metrics: dict[str, Any],
    holdout_metrics: dict[str, Any] | None,
    model_path: Path,
    duration_ms: int,
) -> dict[str, Any]:
    """Keyword-only: this dict has sixteen fields and positional calls to it
    would be unreadable and reorderable without an error."""
    return {
        "run_id": run_id,
        "gold_object_key": spec["goldObjectKey"],
        # MODEL-SERVE-007-T06. `gold_object_key` above is a KEY relative to a
        # bucket, not a location — a reader years from now needs the bucket
        # to find the object at all, and nothing else in this manifest
        # carries it. `.get`, not `[...]`: a claim payload from a NestJS that
        # predates the field must not fail the run, and a manifest missing
        # this field resolves through `class_for_key`'s rootless default,
        # which is correct for every manifest written before today.
        "gold_bucket": spec.get("goldBucket"),
        # The durable reference to the training artifact. It is ALREADY a
        # path segment inside `gold_object_key`, so this promotes a substring
        # to a field: a reference parsed out of a path breaks when the path
        # shape changes, a field does not.
        "gold_artifact_id": spec.get("goldArtifactId"),
        "artifact_checksum": artifact_checksum,
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
        # failed. Deliberately a SEPARATE key, never merged into "metrics".
        "holdout_metrics": holdout_metrics,
        # So a deployed binary can be proven to be this run's output.
        "model_sha256": sha256_of(model_path),
        "duration_ms": duration_ms,
        "framework_versions": framework_versions(spec["algorithm"]),
    }
