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
    """Keyword-only: this dict has fourteen fields and positional calls to it
    would be unreadable and reorderable without an error."""
    return {
        "run_id": run_id,
        "gold_object_key": spec["goldObjectKey"],
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
