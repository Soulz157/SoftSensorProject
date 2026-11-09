"""MODEL-SERVE-045. /predict for lstm/gru.

A sequence model scores row i from rows [i-L+1, i]. Serving builds those
windows with the SAME `build_inference_windows` the trainer's hourly and batch
paths use, so a served value equals the window's. Live 2026-11-02 the real
LSTM 3 model gave 20.3341236 here and 20.3341255 in the trainer image for the
same 24 rows — the same float32 arithmetic on a different CPU — hence the
tolerance below rather than exact equality.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from sequence_model import SequenceRegressor
from services import loader as loader_mod
from services.predict import PredictError, rows_to_predictions
from softsensor_scaling.windows import build_inference_windows

L = 3


@pytest.fixture(scope="module")
def model() -> SequenceRegressor:
    rng = np.random.default_rng(0)
    return SequenceRegressor(
        algorithm="lstm", hidden_size=4, epochs=1, batch_size=4, seed=0
    ).fit(
        rng.normal(size=(16, L, 2)).astype("float32"),
        rng.normal(size=16).astype("float32"),
    )


def _descriptor(**over):
    base = {
        "algorithm": "lstm",
        "sequenceLength": L,
        "featureColumns": ["a", "b"],
        "scalers": {"a": "none", "b": "none"},
        "scalingParams": {},
    }
    base.update(over)
    return base


def _rows(n):
    return [{"a": float(i), "b": float(i) * 0.5} for i in range(n)]


def test_rows_without_a_full_history_are_none_and_the_rest_match_the_trainer(model):
    rows = _rows(5)
    predictions, _ = rows_to_predictions(model, _descriptor(), rows)
    assert predictions[: L - 1] == [None, None]
    matrix = pd.DataFrame(rows)[["a", "b"]].to_numpy(dtype=float)
    X, _ = build_inference_windows(matrix, L, np.ones(5, dtype=bool))
    np.testing.assert_allclose(predictions[L - 1 :], model.predict(X), rtol=1e-6)


def test_too_few_rows_is_a_clear_422(model):
    with pytest.raises(PredictError, match="scores from 3 consecutive rows"):
        rows_to_predictions(model, _descriptor(), _rows(2))


def test_a_gap_in_the_timestamps_leaves_the_rows_across_it_unscored(model):
    rows = _rows(5)
    # 12:00 12:01 [12:02 missing] 12:03 12:04 12:05
    stamps = ["2026-11-02T12:00", "2026-11-02T12:01", "2026-11-02T12:03",
              "2026-11-02T12:04", "2026-11-02T12:05"]
    predictions, _ = rows_to_predictions(
        model, _descriptor(), rows, timestamps=stamps, interval="1m"
    )
    # Rows 2 and 3 reach back across the hole; row 4 (12:03-12:05) is whole.
    assert predictions[:4] == [None, None, None, None]
    assert predictions[4] is not None


def test_timestamps_must_match_the_rows(model):
    with pytest.raises(PredictError, match="`timestamps` has 2 entries"):
        rows_to_predictions(
            model, _descriptor(), _rows(3), timestamps=["a", "b"], interval="1m"
        )


def test_a_tabular_model_is_unchanged():
    class Mean:
        def predict(self, X):
            return X.mean(axis=1).to_numpy()

    predictions, _ = rows_to_predictions(
        Mean(), _descriptor(algorithm="ols"), _rows(2)
    )
    assert predictions == [0.0, 0.75]


def test_torch_version_check_ignores_the_build_tag_but_not_the_numbers():
    import torch

    base = torch.__version__.split("+")[0]
    loader_mod._check_framework_versions({"torch": f"{base}+cpu"})
    with pytest.raises(loader_mod.LoadError, match="Framework version mismatch"):
        loader_mod._check_framework_versions({"torch": "0.0.1"})
