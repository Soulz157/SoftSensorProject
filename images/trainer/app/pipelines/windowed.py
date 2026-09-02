"""MODEL-FLOW-009-T04. lstm/gru: windows, not rows.

The single most important difference from `chronological.py`, and the reason this
is a separate strategy rather than a flag: this path windows over the FULL
time-ordered frame, NEVER the labelled-only frame the tabular path builds.
`windows.build_windows`' own docstring (and its regression test) is why —
consecutive rows in a labelled-only frame are not consecutive in wall-clock time,
so windowing over it would silently span the wrong duration.

Every count this strategy reports (train_rows, test_rows, row_count) is a WINDOW
count, not a row count. That is stated in the splitSpec it produces, because a
future reader of a saved manifest cannot otherwise tell.
"""

from __future__ import annotations

import pandas as pd

from api import RunApi
from config import TIMESTAMP_COLUMN
from guards import assert_no_nan_features, assert_no_window_leakage
from labels import labelled_mask
from metrics import extract_loss_history, regression_metrics
from models import build_model
from pipelines.context import PreparedRun, TrainingResult
from splits import chronological_split_windows
from windows import DEFAULT_SEQUENCE_LENGTH, build_windows


def run(prepared: PreparedRun, api: RunApi) -> TrainingResult:
    sequence_length = int(
        prepared.hyperparameters.get(
            "sequence_length", DEFAULT_SEQUENCE_LENGTH)
    )

    ordered_frame = prepared.frame.sort_values(
        TIMESTAMP_COLUMN).reset_index(drop=True)
    # Re-derived against the re-sorted, re-indexed frame rather than reusing
    # prepared.label_mask: build_windows indexes the mask positionally, so it
    # must share the frame's index exactly.
    ordered_label_mask = labelled_mask(
        ordered_frame, prepared.target_y, log_fn=api.log)

    X, y, window_ts = build_windows(
        ordered_frame,
        prepared.target_y,
        prepared.feature_cols,
        sequence_length,
        ordered_label_mask,
    )
    api.log(
        f"{len(y)} windows of {len(ordered_frame)} rows "
        f"(sequence_length={sequence_length})"
    )
    if len(y) < 30:
        raise RuntimeError(
            f"Only {len(y)} windows have a Good target — too few to split. The "
            f"artifact has {len(prepared.frame)} rows; try a shorter "
            "sequence_length or aggregating to the target's interval."
        )
    assert_no_nan_features(X, "training")

    ratio = float(prepared.spec["splitSpec"].get("ratio", 0.8))
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
        # WINDOW counts, not row counts — unlike every other algorithm's
        # train_rows/test_rows, which genuinely are row counts. Stated here so a
        # future reader of a saved manifest does not assume uniformity across
        # all 11 algorithms.
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "source_rows": int(len(prepared.frame)),
        "labelled_rows": int(len(y)),
    }
    api.log(
        f"Split at {cut_timestamp}: {len(train_idx)} train / "
        f"{len(test_idx)} test windows"
    )

    model = build_model(
        prepared.algorithm,
        prepared.hyperparameters,
        prepared.seed,
        # A WINDOW count. models.build_model checks it against
        # LSTM_MAX_TRAIN_WINDOWS, not GPR_MAX_TRAIN_ROWS.
        len(train_idx),
        prepared.feature_spec,
        log_fn=api.log,
    )
    # Same eval_set-for-loss-history-only contract as lightgbm/xgboost —
    # SequenceRegressor.fit never uses it for early stopping either.
    model.fit(X_train, y_train, eval_set=[
              (X_train, y_train), (X_test, y_test)])

    predicted = model.predict(X_test)
    predicted_train = model.predict(X_train)

    metrics = {
        **regression_metrics(y_test, predicted),
        **regression_metrics(y_train, predicted_train, prefix="train_"),
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "feature_count": len(prepared.feature_cols),
    }
    api.log(
        f"r2={metrics['r2']:.4f} mae={metrics['mae']:.4f} "
        f"rmse={metrics['rmse']:.4f}"
    )

    # ts_test/y_test are the EXACT paired arrays test_idx indexes into — never
    # re-derived from a labelled frame, which does not exist on this path and
    # would be off by window count relative to row count even if it did.
    predictions = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: ts_test.values,
            "y_true": y_test,
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
        holdout_sequence_length=sequence_length,
    )
