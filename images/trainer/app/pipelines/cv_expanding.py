"""MODEL-FLOW-016. k expanding folds, then a refit.

k+1 fits, and only the last one produces an artifact. The k fold models exist to
produce metrics and are discarded; the REFIT over the full labelled frame is what
becomes model.joblib (MODEL-FLOW-016 userDecisions, resolved option b).

Never `sklearn.model_selection.cross_validate`, which returns fold SCORES only
and not the per-fold train_rows/cut_timestamp that cv_folds.json and the
splitSpec variant both require.
"""

from __future__ import annotations

from typing import Any

from api import RunApi
from artifacts import CV_FOLDS_FILENAME
from metrics import aggregate_fold_metrics, regression_metrics
from models import build_model
from pipelines.context import PreparedRun, TrainingResult, labelled_frame
from splits import assert_admissible_fold_count, expanding_fold_plan


def run(prepared: PreparedRun, api: RunApi) -> TrainingResult:
    labelled = labelled_frame(prepared, log_fn=api.log)
    feature_cols = prepared.feature_cols
    target_y = prepared.target_y

    n_splits = int(prepared.spec["splitSpec"]["n_splits"])
    distinct_labelled_values = assert_admissible_fold_count(
        labelled, target_y, n_splits
    )
    fold_plan = expanding_fold_plan(labelled, target_y, n_splits)
    api.log(
        f"CV: {n_splits} expanding folds over {len(labelled)} labelled "
        f"rows ({distinct_labelled_values} distinct values)"
    )

    fold_records: list[dict[str, Any]] = []
    for i, plan in enumerate(fold_plan):
        fold_train_rows = plan["train_rows"]
        fold_test_end = fold_train_rows + plan["test_rows"]
        fold_train = labelled.iloc[:fold_train_rows]
        fold_test = labelled.iloc[fold_train_rows:fold_test_end]

        fold_model = build_model(
            prepared.algorithm,
            prepared.hyperparameters,
            prepared.seed,
            len(fold_train),
            prepared.feature_spec,
            log_fn=api.log,
        )
        fold_model.fit(fold_train[feature_cols], fold_train[target_y])
        fold_pred = fold_model.predict(fold_test[feature_cols])
        fold_pred_train = fold_model.predict(fold_train[feature_cols])

        record = {
            "fold": i + 1,
            "cut_timestamp": plan["cut_timestamp"],
            "train_rows": fold_train_rows,
            "test_rows": plan["test_rows"],
            "distinct": plan["distinct"],
            **regression_metrics(fold_test[target_y], fold_pred),
            **regression_metrics(
                fold_train[target_y], fold_pred_train, prefix="train_"
            ),
        }
        fold_records.append(record)
        api.log(
            f"CV fold {i + 1}/{n_splits}: train={fold_train_rows} "
            f"test={plan['test_rows']} r2={record['r2']:.4f} "
            f"rmse={record['rmse']:.4f}"
        )

    # The REFIT — fit k+1, over the FULL labelled frame. THIS is what becomes
    # model.joblib.
    model = build_model(
        prepared.algorithm,
        prepared.hyperparameters,
        prepared.seed,
        len(labelled),
        prepared.feature_spec,
        log_fn=api.log,
    )
    model.fit(labelled[feature_cols], labelled[target_y])
    api.log(f"CV refit (fit {n_splits + 1}) on {len(labelled)} labelled rows")

    metrics = {
        **aggregate_fold_metrics(fold_records),
        "n_splits": n_splits,
        # MODEL-FLOW-016-T03/V03. The refit's own training row count — must
        # equal the labelled total, never fold k's train count. A refit that
        # silently reused the last fold's model would produce a plausible
        # artifact with a smaller training set, invisible in every other metric.
        "refit_rows": int(len(labelled)),
        "feature_count": len(feature_cols),
    }

    # MODEL-FLOW-016-T04. The lightweight, DB-stored plan — cut/row counts
    # only. The RICH per-fold record (with r2/rmse/mae) is cv_folds.json, a
    # separate object-storage artifact; splitSpec is a compact JSON column, not
    # a metrics dump.
    split_spec = {
        "method": "cv_expanding",
        "n_splits": n_splits,
        "source_rows": int(len(prepared.frame)),
        "labelled_rows": int(len(labelled)),
        "distinct_labelled_values": distinct_labelled_values,
        "folds": [
            {
                "cut_timestamp": f["cut_timestamp"],
                "train_rows": f["train_rows"],
                "test_rows": f["test_rows"],
            }
            for f in fold_records
        ],
    }

    return TrainingResult(
        model=model,
        metrics=metrics,
        split_spec=split_spec,
        # "A CV RUN WRITES NO predictions.parquet, AND THAT IS THE POINT" —
        # under CV there is no single held-out series.
        predictions=None,
        # k+1 independent fits with no single trajectory to show.
        loss_history=None,
        # BOUNDED by construction: k is already capped by
        # assert_admissible_fold_count, so an oversized artifact is unreachable
        # — no redundant size guard needed here.
        extra_json={
            CV_FOLDS_FILENAME: {
                "algorithm": prepared.algorithm,
                "n_splits": n_splits,
                "folds": fold_records,
            }
        },
        # Holdout scoring for a CV run is score.py's job, not this run's.
        holdout_eligible=False,
    )
