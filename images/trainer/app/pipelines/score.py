"""MODEL-FLOW-016-T07. Score mode: a CV run's holdout score as its own phase.

User-triggered, against the REFIT model (model.joblib), never computed inline
during training — see `TrainingResult.holdout_eligible` and the `is_cv` reasoning
in cv_expanding.py. CV is TABULAR ONLY (T01(c), refused in `_select_strategy`
before a CV run ever reaches /complete), so this path never needs the sequence
windowing branch.

Posts to the SCORE-* endpoints only. It does not choose them: `RunApi` routes on
MODE, so there is no code path here that could reach /claim, /log or /complete
even by mistake (see api.py and the MODE doc comment in config.py for why that
separation must hold even on an unhandled crash).
"""

from __future__ import annotations

from api import RunApi
from artifacts import (
    ArtifactSet,
    HOLDOUT_PREDICTIONS_FILENAME,
    PREDICTIONS_FILENAME,
)
from config import SCRATCH, RunContext
from holdout import score_holdout
from storage import download_verified, upload_artifacts

import pandas as pd


def run_scoring(context: RunContext, api: RunApi) -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)

    spec = api.claim()
    target_y = spec["targetY"]
    feature_cols = spec["featureColumns"]
    api.log(
        f"Scoring claimed. target_y={target_y}, {len(feature_cols)} feature "
        "column(s)."
    )

    model_path, _ = download_verified(
        spec["modelUrl"], SCRATCH /
        "model.joblib", spec["modelChecksum"], "Model"
    )
    import joblib

    model = joblib.load(model_path)

    holdout_path, _ = download_verified(
        spec["holdoutDataUrl"],
        SCRATCH / "holdout.parquet",
        spec["holdoutArtifactChecksum"],
        "Holdout",
    )

    # Same implementation the inline train-mode holdout uses — same keys, same
    # row-exclusion behaviour. The Evaluation UI reads holdoutMetrics
    # generically, never knowing (or needing to know) which path produced it,
    # which is precisely why both paths must not be able to drift.
    holdout_metrics, predictions = score_holdout(
        model,
        pd.read_parquet(holdout_path),
        target_y,
        feature_cols,
        dropped_bad_features=spec.get("holdoutDroppedBadRows"),
        log_fn=api.log,
    )

    # MODEL-FLOW-019-T20. A CV run's predictions.parquet is unused until
    # scoring (it never had a test split); a non-CV run's already holds the
    # TEST split the moment training finishes, so its holdout score must
    # land under a different name or this PUT would silently destroy it.
    output_filename = (
        PREDICTIONS_FILENAME
        if spec.get("isCvRun")
        else HOLDOUT_PREDICTIONS_FILENAME
    )
    artifacts = ArtifactSet(SCRATCH)
    artifacts.add_parquet(output_filename, predictions)
    uploaded = upload_artifacts(api, artifacts.as_outputs(), log_fn=api.log)

    api.complete(
        {
            "status": "SUCCEEDED",
            "holdoutMetrics": holdout_metrics,
            "uploaded": uploaded,
        }
    )
    api.log("Scoring complete.")
    return 0
