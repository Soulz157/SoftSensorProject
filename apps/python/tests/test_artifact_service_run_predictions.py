"""MODEL-FLOW-004: `artifact_service.run_predictions`.

`predictions.parquet` is exactly {timestamp, y_true, y_pred} over a training
run's TEST split — a shape `/rows`' `sample_rows` cannot serve (it assumes
per-tag `__status` sidecar columns). This is the reader built for it.

Storage is faked via the shared `RecordingStore` (see `test_artifact_service`'s
own module docstring for why a guarantee that skips when MinIO is down proves
nothing) — this file needs only `get_frame`/`get_json`, both of which the fake
already implements unmodified.
"""

from __future__ import annotations

import pandas as pd
import pytest

from schemas.preprocess import ModelRunPredictionsRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore

RUN_KEY = "drafts/d1/runs/r1/predictions.parquet"
MANIFEST_KEY = "drafts/d1/runs/r1/run_manifest.json"

TS = pd.to_datetime(
    ["2026-02-08 00:46:00", "2026-02-08 00:56:00", "2026-02-08 01:06:00", "2026-02-08 01:16:00"]
)


def predictions_frame() -> pd.DataFrame:
    """Known residuals: [-0.1, 0.1, -0.2, 0.2] -> population sd = sqrt(0.025)."""
    return pd.DataFrame(
        {
            "timestamp": TS,
            "y_true": [1.0, 2.0, 3.0, 4.0],
            "y_pred": [1.1, 1.9, 3.2, 3.8],
        }
    )


def test_computes_scalars_over_the_full_frame() -> None:
    store = RecordingStore({RUN_KEY: predictions_frame()})
    result = artifact_service.run_predictions(
        store, ModelRunPredictionsRequest(source_key=RUN_KEY)
    )

    assert result["row_count"] == 4
    # The service rounds to 6dp before returning — match that, not float64
    # precision.
    assert result["residual_sd"] == pytest.approx(0.025**0.5, abs=1e-6)
    assert result["residual_rmse_check"] == pytest.approx(0.025**0.5, abs=1e-6)
    assert result["y_true_min"] == 1.0
    assert result["y_true_max"] == 4.0
    assert result["y_pred_min"] == 1.1
    assert result["y_pred_max"] == 3.8
    assert len(result["points"]) == 4
    # n === len(points) always — no decimation branch exists to disagree.
    assert result["row_count"] == len(result["points"])
    assert result["points"][0] == {
        "timestamp": "2026-02-08 00:46:00",
        "y_true": 1.0,
        "y_pred": 1.1,
    }


def test_sorts_points_chronologically_regardless_of_input_order() -> None:
    shuffled = predictions_frame().iloc[[2, 0, 3, 1]].reset_index(drop=True)
    store = RecordingStore({RUN_KEY: shuffled})
    result = artifact_service.run_predictions(
        store, ModelRunPredictionsRequest(source_key=RUN_KEY)
    )
    timestamps = [p["timestamp"] for p in result["points"]]
    assert timestamps == sorted(timestamps)


def test_reads_manifest_when_given_and_present() -> None:
    store = RecordingStore({RUN_KEY: predictions_frame()})
    store.documents[MANIFEST_KEY] = {
        "derived_from_target": ["lag_1"],
        "target_scaled": True,
    }
    result = artifact_service.run_predictions(
        store,
        ModelRunPredictionsRequest(source_key=RUN_KEY, manifest_key=MANIFEST_KEY),
    )
    assert result["derived_from_target"] == ["lag_1"]
    assert result["target_scaled"] is True


def test_manifest_absent_is_null_not_a_failure() -> None:
    store = RecordingStore({RUN_KEY: predictions_frame()})
    # manifest_key points at an object that was never written.
    result = artifact_service.run_predictions(
        store,
        ModelRunPredictionsRequest(source_key=RUN_KEY, manifest_key=MANIFEST_KEY),
    )
    assert result["derived_from_target"] is None
    assert result["target_scaled"] is None


def test_no_manifest_key_skips_the_read_entirely() -> None:
    store = RecordingStore({RUN_KEY: predictions_frame()})
    result = artifact_service.run_predictions(
        store, ModelRunPredictionsRequest(source_key=RUN_KEY)
    )
    assert result["derived_from_target"] is None
    assert result["target_scaled"] is None


def test_refuses_a_key_outside_drafts_or_models_root() -> None:
    key = "ds-1/artifacts/gold-1/predictions.parquet"
    store = RecordingStore({key: predictions_frame()})
    with pytest.raises(ValueError, match="not a well-formed training-run output key"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=key)
        )


def test_refuses_a_traversal_attempt_disguised_as_a_run_key() -> None:
    key = "drafts/../secret/runs/r1/predictions.parquet"
    store = RecordingStore({key: predictions_frame()})
    with pytest.raises(ValueError, match="not a well-formed training-run output key"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=key)
        )


def test_refuses_a_key_not_named_predictions_parquet() -> None:
    key = "drafts/d1/runs/r1/metrics.json"
    store = RecordingStore({key: predictions_frame()})
    with pytest.raises(ValueError, match="does not name predictions.parquet"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=key)
        )


def test_accepts_a_model_scoped_key_too() -> None:
    """An adopted run's objects stay under drafts/ permanently (Save Model
    adopts by pointer), but a fresh model-scoped run still writes here — both
    roots must work."""
    key = "models/m1/runs/r1/predictions.parquet"
    store = RecordingStore({key: predictions_frame()})
    result = artifact_service.run_predictions(
        store, ModelRunPredictionsRequest(source_key=key)
    )
    assert result["row_count"] == 4


def test_refuses_a_frame_missing_a_required_column() -> None:
    bad = predictions_frame().drop(columns=["y_pred"])
    store = RecordingStore({RUN_KEY: bad})
    with pytest.raises(ValueError, match=r"missing \['y_pred'\]"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=RUN_KEY)
        )


def test_refuses_a_frame_with_an_extra_column() -> None:
    extra = predictions_frame()
    extra["confidence"] = [0.9, 0.9, 0.9, 0.9]
    store = RecordingStore({RUN_KEY: extra})
    with pytest.raises(ValueError, match=r"unexpected \['confidence'\]"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=RUN_KEY)
        )


def test_refuses_a_non_numeric_prediction_column() -> None:
    bad = predictions_frame()
    bad["y_pred"] = ["a", "b", "c", "d"]
    store = RecordingStore({RUN_KEY: bad})
    with pytest.raises(ValueError, match="Column 'y_pred'.*not numeric"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=RUN_KEY)
        )


def test_refuses_a_test_split_over_the_point_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(artifact_service, "MAX_PREDICTION_POINTS", 2)
    store = RecordingStore({RUN_KEY: predictions_frame()})  # 4 rows > cap of 2
    with pytest.raises(ValueError, match="over the 2"):
        artifact_service.run_predictions(
            store, ModelRunPredictionsRequest(source_key=RUN_KEY)
        )
