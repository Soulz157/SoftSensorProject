"""MODEL-SERVE-026-T05: `artifact_service.run_cv_gap` — the reader for a
retrain candidate's five-column `cv_gap_predictions.parquet`, which the
three-column predictions reader refuses by design."""

from __future__ import annotations

import math

import pandas as pd
import pytest

from schemas.preprocess import ModelRunPredictionsRequest, RunCvGapResponse
from services import artifact_service
from tests.test_artifact_service import RecordingStore

KEY = "models/m1/runs/r1/cv_gap_predictions.parquet"


def cv_gap_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            # Out of order on purpose: the reader sorts by (fold, timestamp).
            "fold": [2, 1, 1, 2],
            "timestamp": pd.to_datetime(
                ["2026-01-04", "2026-01-01", "2026-01-02", "2026-01-03"]
            ),
            "y_true": [4.0, 1.0, 2.0, 3.0],
            "y_pred": [4.5, 1.5, 2.5, 3.5],
            # NaN = before the current version's own cut: not scored there.
            "y_pred_current": [3.0, math.nan, math.nan, 2.0],
        }
    )


def test_reads_every_row_with_fold_and_a_null_current_prediction() -> None:
    store = RecordingStore({KEY: cv_gap_frame()})
    result = artifact_service.run_cv_gap(store, ModelRunPredictionsRequest(source_key=KEY))
    RunCvGapResponse.model_validate(result)
    assert result["row_count"] == 4
    assert [(p["fold"], p["timestamp"][:10]) for p in result["points"]] == [
        (1, "2026-01-01"),
        (1, "2026-01-02"),
        (2, "2026-01-03"),
        (2, "2026-01-04"),
    ]
    # null, never 0 — 0 would read as a real, very wrong prediction.
    assert [p["y_pred_current"] for p in result["points"]] == [None, None, 2.0, 3.0]


def test_refuses_any_other_filename_including_the_three_column_ones() -> None:
    other = "models/m1/runs/r1/new_data_holdout_predictions.parquet"
    with pytest.raises(ValueError, match="does not name cv_gap_predictions.parquet"):
        artifact_service.run_cv_gap(
            RecordingStore({other: cv_gap_frame()}),
            ModelRunPredictionsRequest(source_key=other),
        )


def test_refuses_a_draft_key_and_a_wrong_shape() -> None:
    draft = "drafts/d1/runs/r1/cv_gap_predictions.parquet"
    with pytest.raises(ValueError, match="not a well-formed model-run output key"):
        artifact_service.run_cv_gap(
            RecordingStore({draft: cv_gap_frame()}),
            ModelRunPredictionsRequest(source_key=draft),
        )
    three = cv_gap_frame().drop(columns=["fold", "y_pred_current"])
    with pytest.raises(ValueError, match="not a CV-gap frame"):
        artifact_service.run_cv_gap(
            RecordingStore({KEY: three}), ModelRunPredictionsRequest(source_key=KEY)
        )


def test_the_three_column_reader_still_refuses_this_file() -> None:
    with pytest.raises(ValueError, match="does not name one of"):
        artifact_service.run_predictions(
            RecordingStore({KEY: cv_gap_frame()}),
            ModelRunPredictionsRequest(source_key=KEY),
        )
