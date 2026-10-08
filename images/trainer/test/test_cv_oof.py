"""MODEL-FLOW-028-T01. pipelines/cv_expanding.py keeps each fold's out-of-fold
predictions instead of discarding them."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from artifacts import CV_OOF_PREDICTIONS_FILENAME, PREDICTIONS_FILENAME
from config import TIMESTAMP_COLUMN
from pipelines import cv_expanding
from pipelines.context import PreparedRun

TARGET = "y"
N_SPLITS = 3


def _prepared(rows: int = 200, distinct: int = 40) -> PreparedRun:
    frame = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.date_range("2026-01-01", periods=rows, freq="h"),
            "x": np.arange(rows, dtype=float),
            TARGET: [float(i % distinct) for i in range(rows)],
        }
    )
    return PreparedRun(
        spec={
            "algorithm": "ols",
            "hyperparameters": {},
            "seed": 1,
            "splitSpec": {"method": "cv_expanding", "n_splits": N_SPLITS},
        },
        frame=frame,
        feature_spec={},
        target_y=TARGET,
        feature_cols=["x"],
        label_mask=pd.Series(True, index=frame.index),
        derived=[],
        artifact_checksum="x",
    )


def _api() -> SimpleNamespace:
    return SimpleNamespace(log=lambda *args, **kwargs: None)


def test_oof_series_covers_every_folds_test_rows_once_in_time_order() -> None:
    result = cv_expanding.run(_prepared(), _api())
    oof = result.extra_parquet[CV_OOF_PREDICTIONS_FILENAME]
    folds = result.extra_json["cv_folds.json"]["folds"]

    assert list(oof.columns) == [TIMESTAMP_COLUMN, "y_true", "y_pred"]
    assert len(oof) == sum(f["test_rows"] for f in folds)
    assert oof[TIMESTAMP_COLUMN].is_monotonic_increasing
    assert oof[TIMESTAMP_COLUMN].is_unique


def test_each_fold_slice_reproduces_that_folds_recorded_rmse() -> None:
    result = cv_expanding.run(_prepared(), _api())
    oof = result.extra_parquet[CV_OOF_PREDICTIONS_FILENAME]
    folds = result.extra_json["cv_folds.json"]["folds"]

    start = 0
    for fold in folds:
        part = oof.iloc[start : start + fold["test_rows"]]
        assert part[TIMESTAMP_COLUMN].iloc[0] == pd.Timestamp(fold["cut_timestamp"])
        rmse = float(np.sqrt(((part["y_true"] - part["y_pred"]) ** 2).mean()))
        assert rmse == pytest.approx(fold["rmse"], rel=1e-9, abs=1e-12)
        start += fold["test_rows"]


def test_oof_series_is_not_the_test_split() -> None:
    result = cv_expanding.run(_prepared(), _api())
    # A CV run still writes NO predictions.parquet — the OOF frame is its own
    # population under its own filename (MODEL-FLOW-016 userDecisions).
    assert result.predictions is None
    assert PREDICTIONS_FILENAME not in result.extra_parquet
    assert CV_OOF_PREDICTIONS_FILENAME != PREDICTIONS_FILENAME
