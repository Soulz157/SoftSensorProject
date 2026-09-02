"""Holdout scoring. ONE implementation, two callers.

The original file scored the raw validation holdout twice: inline in `main()`
(DS-LAKE-018-T05) and again in `run_score()` (MODEL-FLOW-016-T07). The two were
near-identical and had already begun to differ — only the inline copy handled
sequence models. Since the Evaluation UI reads `holdoutMetrics` generically,
never knowing which path produced it, the two paths producing different keys or
different row-exclusion behaviour would be invisible until someone compared two
runs by hand.

That is the seam this module sits on: two real adapters (train-inline and
score-mode), one implementation.
"""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from config import TIMESTAMP_COLUMN
from guards import assert_no_nan_features
from labels import labelled_mask
from metrics import regression_metrics
from windows import build_windows

LogFn = Callable[..., None]


def score_holdout(
    model: Any,
    holdout_df: pd.DataFrame,
    target_y: str,
    feature_cols: list[str],
    dropped_bad_features: int | None = None,
    sequence_length: int | None = None,
    log_fn: LogFn | None = None,
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Score a replayed holdout, returning (metrics, predictions frame).

    Returns rather than writes: the train-mode caller records the metrics and
    discards the frame, the score-mode caller uploads the frame as
    predictions.parquet. Neither behaviour belongs in here.

    `sequence_length` is not None only for lstm/gru. CV is tabular-only
    (MODEL-FLOW-016-T01(c)), so the score-mode caller never passes it.

    Raises on any condition that would make the resulting number wrong rather
    than merely absent: a missing feature column, a missing target column, or
    nothing labelled left to score. The train-mode caller wraps this in its own
    best-effort handler; a holdout problem must never fail an otherwise
    successful run.
    """
    holdout_source_rows = len(holdout_df)

    # A container that predicted against the WRONG column set would produce a
    # plausible but silently wrong holdout score, worse than refusing outright.
    missing_cols = [c for c in feature_cols if c not in holdout_df.columns]
    if missing_cols:
        raise RuntimeError(
            f"Replayed holdout is missing feature column(s) {missing_cols} "
            "the model was trained on."
        )
    if target_y not in holdout_df.columns:
        raise RuntimeError(
            f"Replayed holdout has no '{target_y}' column to score against."
        )

    if sequence_length is not None:
        # MODEL-FLOW-009-T04. The same build_windows call training uses — full
        # time-ordered frame, target-row gated — so lstm/gru holdout scoring is
        # not silently skipped (the caller's best-effort handler would otherwise
        # swallow a plain shape mismatch with no signal that this algorithm's
        # holdout scoring never works at all).
        ordered = holdout_df.sort_values(
            TIMESTAMP_COLUMN).reset_index(drop=True)
        ordered_mask = labelled_mask(ordered, target_y, log_fn=log_fn)
        X, y_true, timestamps = build_windows(
            ordered, target_y, feature_cols, sequence_length, ordered_mask
        )
        # Rows NOT reaching a window at all (unlabelled target OR too little
        # history before it) — a broader count than the tabular branch's;
        # named the same key deliberately (both answer "how much of the
        # holdout produced nothing"), documented as broader rather than
        # silently redefined.
        dropped_unlabelled = int(holdout_source_rows - len(y_true))
        if len(y_true) == 0:
            raise RuntimeError(
                f"Holdout produced no labelled windows out of "
                f"{holdout_source_rows} rows (sequence_length="
                f"{sequence_length}) — nothing to score."
            )
        assert_no_nan_features(X, "holdout")
        predicted = model.predict(X)
        row_count = int(len(y_true))
        y_true_values = y_true
        timestamp_values = timestamps.values
    else:
        # DS-LAKE-023-T03/D4. Same mask the train/test split applies, applied
        # here too so the two scores are comparable (both computed over
        # labelled rows only). Before this fix nothing dropped an unlabelled
        # holdout row: for a lab target sampled far sparser than the PI grid,
        # most of the holdout window has no target value, r2_score raises on
        # the resulting NaNs, and the surrounding best-effort handler swallowed
        # it silently.
        mask = labelled_mask(holdout_df, target_y, log_fn=log_fn)
        dropped_unlabelled = int((~mask).sum())
        labelled = holdout_df.loc[mask].reset_index(drop=True)
        if len(labelled) == 0:
            raise RuntimeError(
                f"Holdout has no labelled '{target_y}' rows after excluding "
                f"{dropped_unlabelled} unlabelled row(s) of "
                f"{holdout_source_rows} — nothing to score."
            )
        predicted = model.predict(labelled[feature_cols])
        row_count = int(len(labelled))
        y_true_values = labelled[target_y]
        timestamp_values = labelled[TIMESTAMP_COLUMN].values

    metrics: dict[str, Any] = {
        **regression_metrics(y_true_values, predicted),
        # A WINDOW count for lstm/gru, a row count for every other algorithm —
        # the same distinction splitSpec's train_rows/test_rows documents.
        "row_count": row_count,
        # Reported beside the metrics, not just logged — a score computed over
        # an unstated subset is not comparable to anything (the same reasoning
        # MODEL-FLOW-010-T06 and DS-LAKE-018 already apply to the holdout's
        # missing rate).
        "dropped_unlabelled": dropped_unlabelled,
        # DS-LAKE-023-T05. Rows already dropped server-side (`prepare_holdout_
        # for_run`'s own `drop_bad_feature_rows`, BEFORE it scaled the
        # holdout) — this container never sees those rows at all, so there is
        # nothing to re-derive here; the claim response is the only place this
        # count is known. None for a legacy (BRONZE/replay) holdout, which does
        # not run that exclusion.
        "dropped_bad_features": dropped_bad_features,
    }

    # MODEL-FLOW-016-T07. The EXACT {timestamp, y_true, y_pred} schema the
    # test-split predictions.parquet already uses — this is what lets
    # MODEL-FLOW-004's four Evaluation charts render a CV run's holdout
    # unmodified, reading predictionsKey generically without knowing whether it
    # came from a test split or a holdout score.
    predictions = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: timestamp_values,
            "y_true": (
                y_true_values.values
                if hasattr(y_true_values, "values")
                else y_true_values
            ),
            "y_pred": predicted,
        }
    )

    if log_fn:
        log_fn(
            f"holdout: r2={metrics['r2']:.4f} mae={metrics['mae']:.4f} "
            f"rmse={metrics['rmse']:.4f} ({row_count} rows, "
            f"{dropped_unlabelled} unlabelled dropped, "
            f"{dropped_bad_features} bad-feature dropped)"
        )

    return metrics, predictions
