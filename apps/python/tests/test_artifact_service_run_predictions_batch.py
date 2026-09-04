"""MODEL-FLOW-017-T02: `artifact_service.run_predictions_batch`.

Step 4 Model Selection's overlay + small-multiple charts need every terminal
candidate's actual-vs-predicted series at once, decimated so the payload
stays bounded regardless of test-split size (`run_predictions`'s own
docstring named this as the deferred design this feature implements).

Same `RecordingStore` fake `test_artifact_service_run_predictions.py` uses —
this file needs only `get_frame`.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from schemas.preprocess import RunPredictionsBatchRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore

RUN_KEY_A = "drafts/d1/runs/r1/predictions.parquet"
RUN_KEY_B = "drafts/d1/runs/r2/predictions.parquet"


def predictions_frame(n: int = 4) -> pd.DataFrame:
    """Known residuals for n=4: [-0.1, 0.1, -0.2, 0.2] -> population sd = sqrt(0.025)."""
    if n == 4:
        ts = pd.to_datetime(
            [
                "2026-02-08 00:46:00",
                "2026-02-08 00:56:00",
                "2026-02-08 01:06:00",
                "2026-02-08 01:16:00",
            ]
        )
        return pd.DataFrame(
            {
                "timestamp": ts,
                "y_true": [1.0, 2.0, 3.0, 4.0],
                "y_pred": [1.1, 1.9, 3.2, 3.8],
            }
        )
    ts = pd.date_range("2026-02-08", periods=n, freq="10min")
    rng = np.random.default_rng(42)
    y_true = np.cumsum(rng.normal(0, 1, n))
    y_pred = y_true + rng.normal(0, 0.3, n)
    return pd.DataFrame({"timestamp": ts, "y_true": y_true, "y_pred": y_pred})


def test_computes_scalars_over_the_full_frame_before_decimation() -> None:
    store = RecordingStore({RUN_KEY_A: predictions_frame()})
    result = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A])
    )
    item = result["results"][0]
    assert item["error"] is None
    assert item["row_count"] == 4
    assert item["residual_sd"] == pytest.approx(0.025**0.5, abs=1e-6)
    assert item["residual_rmse_check"] == pytest.approx(0.025**0.5, abs=1e-6)
    assert item["downsampled"] is False  # 4 rows, well under any max_points
    assert len(item["points"]) == 4


def test_paired_decimation_keeps_y_pred_at_the_same_timestamps_as_y_true() -> None:
    """PROVE PAIRED DECIMATION (MODEL-FLOW-017-V02). Every kept y_pred must
    share a timestamp with a kept y_true — the decimation is driven off
    (timestamp, y_true) and y_pred is sliced by the SAME index set, never
    independently sampled. Asserting only the reduced length would pass
    against two independently sampled series, the exact defect this
    constraint exists to prevent."""
    frame = predictions_frame(200)
    store = RecordingStore({RUN_KEY_A: frame})
    result = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A], max_points=50)
    )
    item = result["results"][0]
    assert item["error"] is None
    assert item["downsampled"] is True
    assert 0 < len(item["points"]) <= 50

    sorted_frame = frame.sort_values("timestamp").reset_index(drop=True)
    ts_to_row = {
        ts.isoformat(sep=" "): (y_true, y_pred)
        for ts, y_true, y_pred in zip(
            sorted_frame["timestamp"], sorted_frame["y_true"], sorted_frame["y_pred"]
        )
    }
    for point in item["points"]:
        expected_true, expected_pred = ts_to_row[point["timestamp"]]
        assert point["y_true"] == pytest.approx(expected_true, abs=1e-6)
        assert point["y_pred"] == pytest.approx(expected_pred, abs=1e-6)


def test_residual_sd_from_a_decimated_response_matches_the_full_frame_value() -> None:
    """MODEL-FLOW-017-V03 shape (in miniature — the digit-exact fixture
    against run 61f9aa28 lives in the backend/integration verification
    pass): decimating the POINTS must never change the FULL-frame scalar.
    """
    frame = predictions_frame(500)
    residual = frame["y_true"] - frame["y_pred"]
    full_sd = round(float(residual.std(ddof=0)), 6)

    store = RecordingStore({RUN_KEY_A: frame})
    undecimated = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A], max_points=2000)
    )["results"][0]
    decimated = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A], max_points=50)
    )["results"][0]

    assert undecimated["downsampled"] is False
    assert decimated["downsampled"] is True
    assert undecimated["residual_sd"] == full_sd
    assert decimated["residual_sd"] == full_sd
    assert decimated["residual_sd"] == undecimated["residual_sd"]


def test_one_bad_run_soft_fails_without_blanking_the_others() -> None:
    """One candidate's unreadable artifact must not fail the whole batch —
    mirrors the loss-history hydration precedent in
    `reconcileAndShape` (model-candidate-job.authorized.service.ts)."""
    store = RecordingStore({RUN_KEY_A: predictions_frame()})
    # RUN_KEY_B is never registered in the store -> ObjectStoreError on read.
    result = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A, RUN_KEY_B])
    )
    ok, bad = result["results"]
    assert ok["source_key"] == RUN_KEY_A
    assert ok["error"] is None
    assert ok["row_count"] == 4

    assert bad["source_key"] == RUN_KEY_B
    assert bad["error"] is not None
    assert bad["row_count"] is None
    assert bad["points"] == []


def test_refuses_a_key_outside_drafts_or_models_root_as_a_soft_failure() -> None:
    key = "ds-1/artifacts/gold-1/predictions.parquet"
    store = RecordingStore({key: predictions_frame()})
    result = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[key])
    )
    item = result["results"][0]
    assert item["error"] is not None
    assert "not a well-formed training-run output key" in item["error"]


def test_refuses_a_run_over_max_prediction_points(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(artifact_service, "MAX_PREDICTION_POINTS", 2)
    store = RecordingStore({RUN_KEY_A: predictions_frame()})  # 4 rows > cap of 2
    result = artifact_service.run_predictions_batch(
        store, RunPredictionsBatchRequest(keys=[RUN_KEY_A])
    )
    item = result["results"][0]
    assert item["error"] is not None
    assert "over the 2" in item["error"]


def test_request_schema_caps_keys_at_max_prediction_batch_runs() -> None:
    from schemas.preprocess import MAX_PREDICTION_BATCH_RUNS
    import pydantic

    too_many = [f"drafts/d1/runs/r{i}/predictions.parquet" for i in range(MAX_PREDICTION_BATCH_RUNS + 1)]
    with pytest.raises(pydantic.ValidationError):
        RunPredictionsBatchRequest(keys=too_many)


def test_request_schema_caps_max_points_at_max_prediction_batch_points() -> None:
    from schemas.preprocess import MAX_PREDICTION_BATCH_POINTS
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        RunPredictionsBatchRequest(
            keys=[RUN_KEY_A], max_points=MAX_PREDICTION_BATCH_POINTS + 1
        )
