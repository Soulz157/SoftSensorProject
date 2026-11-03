"""MODEL-SERVE-043. lstm/gru scoring outside training: hourly windows
(`pipelines/infer.py`) and batch (`pipelines/batch.py`).

Before this, both paths handed a sequence model a 2-D frame and every window
FAILED with `could not determine the shape of object type 'DataFrame'`. The
gate here is the parity test: scoring-time windows must be exactly the windows
training built, or every prediction is shifted a step with nothing to say so.

The fake model returns each window's LAST step, first feature — so a
prediction's value names the row it was built for, and alignment is checkable
without torch.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest

from pipelines import batch as batch_pipeline
from pipelines import infer as infer_pipeline
from windows import build_inference_windows, build_windows

L = 24


class LastStepModel:
    def predict(self, X: np.ndarray) -> np.ndarray:
        assert X.ndim == 3, "a sequence model must receive (n, L, features)"
        return X[:, -1, 0]


class FakeApi:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def log(self, message: str, level: str = "info") -> None:
        self.lines.append(message)


def _frame(n: int, start: str = "2026-01-01 00:00") -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.date_range(start, periods=n, freq="min"),
            "a": np.arange(n, dtype=float),
            "b": np.arange(n, dtype=float) * 10.0,
        }
    )


# ── build_inference_windows ───────────────────────────────────────────────


def test_parity_with_training_windows() -> None:
    frame = _frame(100)
    frame["y"] = 0.0
    X_train, _, _ = build_windows(
        frame, "y", ["a", "b"], L, pd.Series(True, index=frame.index)
    )
    X_score, positions = build_inference_windows(
        frame[["a", "b"]].to_numpy(dtype=float),
        L,
        np.ones(len(frame), dtype=bool),
        timestamps=frame["timestamp"],
        interval=pd.Timedelta(minutes=1),
    )
    np.testing.assert_array_equal(X_score, X_train)
    assert positions.tolist() == list(range(L - 1, 100))


def test_lead_in_rows_are_history_only() -> None:
    frame = _frame(23 + 60)
    scorable = np.r_[np.zeros(23, dtype=bool), np.ones(60, dtype=bool)]
    X, positions = build_inference_windows(
        frame[["a", "b"]].to_numpy(dtype=float), L, scorable,
        timestamps=frame["timestamp"], interval=pd.Timedelta(minutes=1),
    )
    assert len(X) == 60
    assert positions.tolist() == list(range(23, 83))


def test_a_dropped_row_skips_exactly_the_windows_spanning_it() -> None:
    frame = _frame(100).drop(index=50).reset_index(drop=True)  # minute 50 gone
    _, positions = build_inference_windows(
        frame[["a", "b"]].to_numpy(dtype=float), L,
        np.ones(len(frame), dtype=bool),
        timestamps=frame["timestamp"], interval=pd.Timedelta(minutes=1),
    )
    scored = frame["timestamp"].iloc[positions]
    minutes = set((scored.dt.hour * 60 + scored.dt.minute).tolist())
    # A row is scored only if its 24 minutes are all present: minutes 51..73
    # reach back across the hole, so the first scorable minute after it is 74.
    assert 49 in minutes
    assert not set(range(51, 74)) & minutes
    assert 74 in minutes


def test_nan_inside_the_window_skips_that_row() -> None:
    matrix = _frame(60)[["a", "b"]].to_numpy(dtype=float)
    matrix[40, 1] = np.nan
    _, positions = build_inference_windows(matrix, L, np.ones(60, dtype=bool))
    assert not set(range(40, 64)) & set(positions.tolist())
    assert 39 in positions


def test_too_few_rows_returns_empty() -> None:
    X, positions = build_inference_windows(
        np.zeros((10, 2)), L, np.ones(10, dtype=bool)
    )
    assert X.shape == (0, L, 2) and positions.size == 0


# ── infer.py ──────────────────────────────────────────────────────────────


def test_parse_interval() -> None:
    assert infer_pipeline.parse_interval("1m") == pd.Timedelta(minutes=1)
    assert infer_pipeline.parse_interval("30s") == pd.Timedelta(seconds=30)
    assert infer_pipeline.parse_interval("1h") == pd.Timedelta(hours=1)
    assert infer_pipeline.parse_interval("") is None
    assert infer_pipeline.parse_interval(None) is None
    assert infer_pipeline.parse_interval("0m") is None


def _infer(frame: pd.DataFrame, spec: dict, monkeypatch, tmp_path, context=None):
    if context is not None:
        path = tmp_path / "context.parquet"
        context.to_parquet(path, index=False)
        monkeypatch.setattr(
            infer_pipeline, "download_verified", lambda *a, **k: (path, "x")
        )
        spec = {**spec, "contextUrl": "presigned", "contextChecksum": "x"}
    api = FakeApi()
    out = infer_pipeline._score_sequence(
        LastStepModel(), frame, spec, ["a", "b"],
        {"a": "none", "b": "none"}, {}, api,
    )
    return out, api


def test_infer_scores_all_60_window_rows_with_a_lead_in(monkeypatch, tmp_path) -> None:
    full = _frame(23 + 60)
    context, window = full.iloc[:23], full.iloc[23:].reset_index(drop=True)
    out, api = _infer(
        window,
        {"algorithm": "lstm", "sequenceLength": 24, "intervalTime": "1m"},
        monkeypatch, tmp_path, context=context,
    )
    assert len(out) == 60
    # Each prediction is its OWN row's value: no shift.
    assert out["prediction"].tolist() == window["a"].tolist()
    assert out["timestamp"].tolist() == window["timestamp"].tolist()
    assert any("23 lead-in row(s), 60 of 60" in line for line in api.lines)


def test_infer_without_a_lead_in_scores_only_rows_with_history(monkeypatch, tmp_path) -> None:
    window = _frame(60)
    out, _ = _infer(
        window, {"algorithm": "gru", "sequenceLength": 24, "intervalTime": "1m"},
        monkeypatch, tmp_path,
    )
    assert len(out) == 60 - (L - 1)
    assert out["prediction"].iloc[0] == window["a"].iloc[L - 1]


def test_infer_with_no_scorable_row_fails_with_the_reason(monkeypatch, tmp_path) -> None:
    with pytest.raises(RuntimeError, match="consecutive Good rows of history"):
        _infer(
            _frame(10),
            {"algorithm": "lstm", "sequenceLength": 24, "intervalTime": "1m"},
            monkeypatch, tmp_path,
        )


def test_infer_falls_back_to_the_data_step_without_an_interval(monkeypatch, tmp_path) -> None:
    window = _frame(60)
    out, api = _infer(
        window, {"algorithm": "lstm", "sequenceLength": 24},
        monkeypatch, tmp_path,
    )
    assert len(out) == 60 - (L - 1)
    assert any("data's own step" in line for line in api.lines)


# ── batch.py ──────────────────────────────────────────────────────────────


def test_batch_first_rows_are_null_and_one_row_per_input_row() -> None:
    matrix = _frame(50)[["a", "b"]].to_numpy(dtype=float)
    preds, carry = batch_pipeline._score_sequence_chunk(
        LastStepModel(), matrix, np.empty((0, 2)), L
    )
    assert len(preds) == 50
    assert np.isnan(preds[: L - 1]).all()
    np.testing.assert_array_equal(preds[L - 1:], matrix[L - 1:, 0])
    assert carry.shape == (L - 1, 2)


def test_batch_chunk_boundary_matches_unchunked() -> None:
    matrix = _frame(130)[["a", "b"]].to_numpy(dtype=float)
    whole, _ = batch_pipeline._score_sequence_chunk(
        LastStepModel(), matrix, np.empty((0, 2)), L
    )
    carry = np.empty((0, 2))
    parts = []
    for chunk in (matrix[:40], matrix[40:45], matrix[45:]):
        preds, carry = batch_pipeline._score_sequence_chunk(
            LastStepModel(), chunk, carry, L
        )
        parts.append(preds)
    np.testing.assert_array_equal(np.concatenate(parts), whole)


def test_batch_nulls_are_written_as_parquet_nulls() -> None:
    preds, _ = batch_pipeline._score_sequence_chunk(
        LastStepModel(), _frame(30)[["a", "b"]].to_numpy(dtype=float),
        np.empty((0, 2)), L,
    )
    table = pa.Table.from_pandas(
        pd.DataFrame({"prediction": preds}), preserve_index=False
    )
    assert table.column("prediction").null_count == L - 1


def test_a_real_lstm_scores_the_window_the_old_path_refused(monkeypatch, tmp_path) -> None:
    """The 2026-11-01 repro, end to end: the same SequenceRegressor that
    raised `could not determine the shape of object type 'DataFrame'` on the
    tabular path now scores every window row."""
    pytest.importorskip("torch")
    from sequence_model import SequenceRegressor

    rng = np.random.default_rng(0)
    model = SequenceRegressor(
        algorithm="lstm", hidden_size=8, epochs=1, batch_size=8, seed=0
    ).fit(
        rng.normal(size=(40, L, 2)).astype("float32"),
        rng.normal(size=40).astype("float32"),
    )
    full = _frame(23 + 60)
    context, window = full.iloc[:23], full.iloc[23:].reset_index(drop=True)
    path = tmp_path / "context.parquet"
    context.to_parquet(path, index=False)
    monkeypatch.setattr(
        infer_pipeline, "download_verified", lambda *a, **k: (path, "x")
    )
    with pytest.raises(ValueError, match="could not determine the shape"):
        model.predict(window[["a", "b"]])  # the old tabular call
    out = infer_pipeline._score_sequence(
        model, window,
        {"algorithm": "lstm", "sequenceLength": 24, "intervalTime": "1m",
         "contextUrl": "presigned", "contextChecksum": "x"},
        ["a", "b"], {"a": "none", "b": "none"}, {}, FakeApi(),
    )
    assert len(out) == 60
    assert np.isfinite(out["prediction"]).all()
