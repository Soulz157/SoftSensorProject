"""MODEL-SERVE-026-T05. pipelines/cv_gap.py — the CV measurement of the gap
between a retrain candidate and the current version."""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from config import TIMESTAMP_COLUMN
from pipelines.cv_gap import CV_GAP_COLUMNS, cv_gap_if_requested, measure_cv_gap
from splits import expanding_fold_plan

TARGET = "y"


def _labelled(rows: int = 200, distinct: int = 40) -> pd.DataFrame:
    """Hourly rows; the target cycles through `distinct` values, so the fold
    cap is distinct // 10."""
    return pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.date_range("2026-01-01", periods=rows, freq="h"),
            "x": np.arange(rows, dtype=float),
            TARGET: [float(i % distinct) for i in range(rows)],
        }
    )


def _fit_predict(_train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    return test[TARGET].to_numpy() + 1.0


def test_series_covers_every_folds_test_rows_in_the_trainers_own_fold_plan() -> None:
    labelled = _labelled()
    series = measure_cv_gap(
        labelled, TARGET, 3, _fit_predict, lambda r: r[TARGET].to_numpy(),
        pd.Timestamp("2025-01-01"),
    )
    plan = expanding_fold_plan(labelled, TARGET, 3)
    assert list(series.columns) == CV_GAP_COLUMNS
    assert series.groupby("fold").size().tolist() == [p["test_rows"] for p in plan]
    assert (series["y_pred"] == series["y_true"] + 1.0).all()


def test_the_current_version_is_never_scored_on_rows_before_its_own_cut() -> None:
    labelled = _labelled()
    cut = labelled[TIMESTAMP_COLUMN].iloc[120]
    seen: list[pd.Timestamp] = []

    def current(rows: pd.DataFrame) -> np.ndarray:
        seen.extend(rows[TIMESTAMP_COLUMN].tolist())
        return rows[TARGET].to_numpy()

    series = measure_cv_gap(labelled, TARGET, 3, _fit_predict, current, cut)
    assert seen and min(seen) >= cut
    before = series[series[TIMESTAMP_COLUMN] < cut]
    after = series[series[TIMESTAMP_COLUMN] >= cut]
    assert len(before) > 0 and before["y_pred_current"].isna().all()
    assert after["y_pred_current"].notna().all()


def test_fold_cap_admits_k_at_the_cap_and_refuses_one_above_it() -> None:
    labelled = _labelled(distinct=40)  # cap = 40 // 10 = 4
    ok = measure_cv_gap(
        labelled, TARGET, 4, _fit_predict, lambda r: r[TARGET].to_numpy(),
        pd.Timestamp("2025-01-01"),
    )
    assert ok["fold"].nunique() == 4
    with pytest.raises(RuntimeError, match="exceeds the admissible maximum of 4"):
        measure_cv_gap(
            labelled, TARGET, 5, _fit_predict, lambda r: r[TARGET].to_numpy(),
            pd.Timestamp("2025-01-01"),
        )


class _Api:
    def __init__(self) -> None:
        self.lines: list[tuple[str, str]] = []

    def log(self, message: str, level: str = "info") -> None:
        self.lines.append((level, message))


def test_no_cv_gap_in_the_spec_means_nothing_runs() -> None:
    prepared = SimpleNamespace(spec={})
    assert cv_gap_if_requested(prepared, _Api(), None) is None


def test_the_real_wiring_fits_real_models_and_scores_the_current_version(
    tmp_path, monkeypatch
) -> None:
    """The wrapper end to end with real scikit-learn estimators — only the
    presigned download and the frame loader are stubbed, so `build_model`,
    the joblib round trip and the current version's own feature columns are
    exercised as the container runs them."""
    import joblib
    from sklearn.linear_model import LinearRegression

    import pipelines.context as context
    import storage

    labelled = _labelled()
    current = LinearRegression().fit(labelled[["x"]], labelled[TARGET])
    model_path = tmp_path / "current.joblib"
    joblib.dump(current, model_path)
    monkeypatch.setattr(storage, "download_verified", lambda *_a, **_k: (model_path, "sum"))
    monkeypatch.setattr(context, "labelled_frame", lambda *_a, **_k: labelled)

    cut = labelled[TIMESTAMP_COLUMN].iloc[100]
    prepared = SimpleNamespace(
        spec={
            "cvGap": {"nSplits": 3, "currentCutTimestamp": str(cut)},
            "incumbentModelUrl": "u",
            "incumbentModelChecksum": "c",
            "incumbentFeatureColumns": ["x"],
        },
        algorithm="ridge",
        hyperparameters={},
        seed=0,
        feature_spec={},
        feature_cols=["x"],
        target_y=TARGET,
    )
    api = _Api()
    series = cv_gap_if_requested(prepared, api, tmp_path)
    assert series is not None, api.lines
    assert series["fold"].nunique() == 3
    assert series["y_pred"].notna().all()
    scored = series[series[TIMESTAMP_COLUMN] >= cut]
    rows = labelled[labelled[TIMESTAMP_COLUMN].isin(scored[TIMESTAMP_COLUMN])]
    np.testing.assert_allclose(
        scored["y_pred_current"].to_numpy(), current.predict(rows[["x"]])
    )
    assert series[series[TIMESTAMP_COLUMN] < cut]["y_pred_current"].isna().all()


def test_cv_gap_without_a_presigned_current_model_is_skipped_and_said() -> None:
    api = _Api()
    prepared = SimpleNamespace(spec={"cvGap": {"nSplits": 3, "currentCutTimestamp": "2026-01-01"}})
    assert cv_gap_if_requested(prepared, api, None) is None
    assert api.lines == [("warn", "CV gap skipped: no current-version model was presigned")]
