"""MODEL-SERVE-026-T05. Expanding-window CV of the GAP between a retrain
candidate and the current version — an EXTRA measurement inside a normal
chronological run, never a replacement for it.

Why not a `cv_expanding` run: that strategy sets `holdout_eligible=False`, and
the shared-window scoring (`_score_new_data_holdout_if_present`) is then
skipped entirely — the new-vs-current comparison the Retrain tab stands on
would disappear. And a fold metric alone describes the candidate's
CONFIGURATION, not the gap: the current version is never scored per fold
there. So this module keeps the run chronological (ranking on
`metrics.rmse`, window scoring and the shipped model's plain `r2` all
untouched) and, when the spec asks, refits the candidate's configuration on
each expanding fold and scores BOTH that fit and the current version on the
fold's test rows.

LEAKAGE RULE. The current version is a fixed, already-trained model: it is
scored only on fold-test rows at or after its own cut. Rows before the cut
may be rows it trained on, so they get no current prediction (NaN) — never a
score on its own training data.

ONE DETECTOR. This writes the per-row series only; the client picks lab
events and scores folds with the same rule it uses everywhere
(lib/retrain-lab-events.ts). No second copy of that rule lives here.

Best-effort like every other extra measurement in this package: any failure
logs and returns None; a CV problem never fails the run.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

from config import TIMESTAMP_COLUMN
from splits import assert_admissible_fold_count, expanding_fold_plan

FitPredict = Callable[[pd.DataFrame, pd.DataFrame], np.ndarray]
"""(fold_train, fold_test) -> candidate predictions for fold_test."""

CurrentPredict = Callable[[pd.DataFrame], np.ndarray]
"""(rows) -> the current version's predictions for those rows."""

CV_GAP_COLUMNS = ["fold", TIMESTAMP_COLUMN, "y_true", "y_pred", "y_pred_current"]


def measure_cv_gap(
    labelled: pd.DataFrame,
    target_y: str,
    n_splits: int,
    fit_predict: FitPredict,
    current_predict: CurrentPredict,
    current_cut: pd.Timestamp,
) -> pd.DataFrame:
    """Per-row series over every fold's test rows. `labelled` must be the
    labelled, TIMESTAMP_COLUMN-sorted frame with a reset index — the same
    contract `expanding_fold_plan` documents. Refuses (raises) above the
    measured fold cap, exactly like the cv_expanding fit-time backstop."""
    assert_admissible_fold_count(labelled, target_y, n_splits)
    parts: list[pd.DataFrame] = []
    for i, plan in enumerate(expanding_fold_plan(labelled, target_y, n_splits)):
        start = plan["train_rows"]
        end = start + plan["test_rows"]
        fold_train = labelled.iloc[:start]
        fold_test = labelled.iloc[start:end]
        y_pred = np.asarray(fit_predict(fold_train, fold_test), dtype=float)

        y_pred_current = np.full(len(fold_test), np.nan)
        eligible = (fold_test[TIMESTAMP_COLUMN] >= current_cut).to_numpy()
        if eligible.any():
            y_pred_current[eligible] = np.asarray(
                current_predict(fold_test[eligible]), dtype=float
            )

        parts.append(
            pd.DataFrame(
                {
                    "fold": i + 1,
                    TIMESTAMP_COLUMN: fold_test[TIMESTAMP_COLUMN].to_numpy(),
                    "y_true": fold_test[target_y].to_numpy(dtype=float),
                    "y_pred": y_pred,
                    "y_pred_current": y_pred_current,
                }
            )
        )
    return pd.concat(parts, ignore_index=True)[CV_GAP_COLUMNS]


def cv_gap_if_requested(prepared: Any, api: Any, scratch: Any) -> pd.DataFrame | None:
    """Wires `measure_cv_gap` to a real run. Present only when the backend put
    `cvGap` in the spec (a NEW_DATA_ONLY retrain that asked for it) AND the
    claim presigned the current version's model; absent otherwise, so every
    other run — wizard, AUGMENT_DATA, a job from before this field — is
    untouched."""
    config = prepared.spec.get("cvGap")
    if not config:
        return None
    if not (
        prepared.spec.get("incumbentModelUrl")
        and prepared.spec.get("incumbentFeatureColumns")
    ):
        api.log("CV gap skipped: no current-version model was presigned", "warn")
        return None
    try:
        import joblib

        from models import build_model
        from pipelines.context import labelled_frame
        from storage import download_verified

        n_splits = int(config["nSplits"])
        current_cut = pd.Timestamp(config["currentCutTimestamp"])
        current_cols = list(prepared.spec["incumbentFeatureColumns"])
        current_path, _ = download_verified(
            prepared.spec["incumbentModelUrl"],
            scratch / "incumbent_model_cv.joblib",
            prepared.spec["incumbentModelChecksum"],
            "Current version model",
        )
        current_model = joblib.load(current_path)
        labelled = labelled_frame(prepared, log_fn=api.log)
        feature_cols = prepared.feature_cols
        target_y = prepared.target_y

        def fit_predict(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
            model = build_model(
                prepared.algorithm,
                prepared.hyperparameters,
                prepared.seed,
                len(train),
                prepared.feature_spec,
                log_fn=api.log,
            )
            model.fit(train[feature_cols], train[target_y])
            return model.predict(test[feature_cols])

        series = measure_cv_gap(
            labelled,
            target_y,
            n_splits,
            fit_predict,
            lambda rows: current_model.predict(rows[current_cols]),
            current_cut,
        )
        scored = int(series["y_pred_current"].notna().sum())
        api.log(
            f"CV gap: {n_splits} expanding folds, {len(series)} test rows, "
            f"{scored} also scored for the current version"
        )
        return series
    except Exception as exc:  # noqa: BLE001 - best-effort, see module docstring
        api.log(f"CV gap skipped: {exc}", "warn")
        return None


__all__ = ["CV_GAP_COLUMNS", "cv_gap_if_requested", "measure_cv_gap"]
