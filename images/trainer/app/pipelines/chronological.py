"""Tabular, single chronological cut. Nine of the eleven algorithms.

This is the path that was already correct in the original file; the split
preserves it line for line, including which two algorithms receive an eval_set
and why.
"""

from __future__ import annotations

from api import RunApi
from metrics import extract_loss_history, regression_metrics
from models import build_model
from pipelines.context import PreparedRun, TrainingResult, labelled_frame
from splits import chronological_split
from config import TIMESTAMP_COLUMN

import pandas as pd


def run(prepared: PreparedRun, api: RunApi) -> TrainingResult:
    labelled = labelled_frame(prepared, log_fn=api.log)

    ratio = float(prepared.spec["splitSpec"].get("ratio", 0.8))
    train, test, cut_timestamp = chronological_split(labelled, ratio)
    split_spec = {
        "method": "chronological",
        "ratio": ratio,
        "cut_timestamp": cut_timestamp,
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        # The pre-drop count, kept alongside so the sparsity is visible in the
        # record rather than only in a log line.
        "source_rows": int(len(prepared.frame)),
        "labelled_rows": int(len(labelled)),
    }
    api.log(
        f"Split at {cut_timestamp}: {len(train)} train / {len(test)} test")

    feature_cols = prepared.feature_cols
    target_y = prepared.target_y

    model = build_model(
        prepared.algorithm,
        prepared.hyperparameters,
        prepared.seed,
        len(train),
        prepared.feature_spec,
        log_fn=api.log,
    )

    # MODEL-FLOW-013-T05. eval_set is passed ONLY to RECORD a loss trajectory
    # (metrics.extract_loss_history) — no early_stopping_rounds anywhere, so
    # this never changes when training stops or what the fitted model is, for
    # any algorithm. Every other algorithm's fit call is untouched.
    if prepared.algorithm == "lightgbm":
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
    elif prepared.algorithm == "xgboost":
        # eval_metric lives on the constructor for xgboost (see models.py) —
        # only eval_set belongs here.
        model.fit(
            train[feature_cols],
            train[target_y],
            eval_set=[
                (train[feature_cols], train[target_y]),
                (test[feature_cols], test[target_y]),
            ],
            verbose=False,
        )
    else:
        model.fit(train[feature_cols], train[target_y])

    predicted = model.predict(test[feature_cols])
    predicted_train = model.predict(train[feature_cols])

    metrics = {
        **regression_metrics(test[target_y], predicted),
        **regression_metrics(train[target_y], predicted_train, prefix="train_"),
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "feature_count": len(feature_cols),
    }
    api.log(
        f"r2={metrics['r2']:.4f} mae={metrics['mae']:.4f} "
        f"rmse={metrics['rmse']:.4f}"
    )

    predictions = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: test[TIMESTAMP_COLUMN].values,
            "y_true": test[target_y].values,
            "y_pred": predicted,
        }
    )

    return TrainingResult(
        model=model,
        metrics=metrics,
        split_spec=split_spec,
        predictions=predictions,
        loss_history=extract_loss_history(
            prepared.algorithm, model, log_fn=api.log),
        holdout_eligible=True,
    )
