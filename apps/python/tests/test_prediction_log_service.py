from datetime import datetime, timedelta, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from intergrations.object_store import ObjectStoreError, is_serving_log_key
from schemas.preprocess import (
    PredictionLogAppendRequest,
    PredictionLogRow,
    PredictionLogSeriesRequest,
)
from services import prediction_log_service


class RecordingStore:
    """Minimal in-memory ObjectStore stand-in — same pattern already used
    across apps/python/tests/test_export_service.py and friends. Only
    implements what `prediction_log_service` actually calls:
    `put_object_bytes`, `get_frame`, `list_object_keys`.
    """

    def __init__(self) -> None:
        self.raw_objects: dict[str, bytes] = {}

    def put_object_bytes(self, key, data, *, content_type="application/octet-stream", tags=None):
        self.raw_objects[key] = data

    def get_frame(self, key, columns=None):
        if key not in self.raw_objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        table = pq.read_table(pa.BufferReader(self.raw_objects[key]), columns=columns)
        return table.to_pandas()

    def list_object_keys(self, prefix: str) -> list[str]:
        return sorted(k for k in self.raw_objects if k.startswith(prefix))


def _append_request(ts: datetime, n_rows: int = 2) -> PredictionLogAppendRequest:
    rows = [
        PredictionLogRow(
            features={"TI202.PV": 0.5 + i * 0.01, "AI001A2.PV": 0.7},
            prediction=0.42 + i * 0.001,
        )
        for i in range(n_rows)
    ]
    return PredictionLogAppendRequest(
        model_id="model-1",
        model_version_id="ver-1",
        requested_at=ts,
        rows=rows,
    )


def test_append_writes_one_object_under_the_hour_partition():
    store = RecordingStore()
    ts = datetime(2026, 9, 3, 8, 15, tzinfo=timezone.utc)

    result = prediction_log_service.append(store, _append_request(ts))

    assert result["row_count"] == 2
    key = result["object_key"]
    assert is_serving_log_key(key)
    assert key.startswith("serving-logs/model-1/ver-1/dt=2026-09-03/hour=08/")
    assert key in store.raw_objects
    assert result["object_checksum"]


def test_append_frame_carries_shared_timestamp_features_and_prediction():
    store = RecordingStore()
    ts = datetime(2026, 9, 3, 8, 15, tzinfo=timezone.utc)

    result = prediction_log_service.append(store, _append_request(ts, n_rows=3))

    table = pq.read_table(pa.BufferReader(store.raw_objects[result["object_key"]]))
    frame = table.to_pandas()
    assert len(frame) == 3
    assert set(frame.columns) == {"timestamp", "TI202.PV", "AI001A2.PV", "prediction"}
    assert frame["prediction"].tolist() == pytest.approx([0.42, 0.421, 0.422])


def test_append_requires_at_least_one_row():
    with pytest.raises(Exception):
        PredictionLogAppendRequest(
            model_id="model-1",
            model_version_id="ver-1",
            requested_at=datetime.now(timezone.utc),
            rows=[],
        )


def test_series_reads_across_two_hour_partitions_in_time_order():
    store = RecordingStore()
    base = datetime(2026, 9, 3, 8, 0, tzinfo=timezone.utc)

    prediction_log_service.append(store, _append_request(base + timedelta(minutes=50), n_rows=1))
    prediction_log_service.append(
        store, _append_request(base + timedelta(hours=1, minutes=5), n_rows=1)
    )

    result = prediction_log_service.series(
        store,
        PredictionLogSeriesRequest(
            model_id="model-1",
            model_version_id="ver-1",
            **{"from": base, "to": base + timedelta(hours=2)},
        ),
    )

    assert result["truncated"] is False
    points = result["points"]
    assert len(points) == 2
    assert points[0].timestamp <= points[1].timestamp
    assert all(p.prediction == pytest.approx(0.42) for p in points)


def test_series_excludes_rows_outside_the_requested_range():
    store = RecordingStore()
    base = datetime(2026, 9, 3, 8, 0, tzinfo=timezone.utc)

    prediction_log_service.append(store, _append_request(base, n_rows=1))
    prediction_log_service.append(store, _append_request(base + timedelta(hours=5), n_rows=1))

    result = prediction_log_service.series(
        store,
        PredictionLogSeriesRequest(
            model_id="model-1",
            model_version_id="ver-1",
            **{"from": base, "to": base + timedelta(minutes=30)},
        ),
    )

    assert len(result["points"]) == 1


def test_series_returns_empty_for_an_hour_with_nothing_logged():
    store = RecordingStore()
    base = datetime(2026, 9, 3, 8, 0, tzinfo=timezone.utc)

    result = prediction_log_service.series(
        store,
        PredictionLogSeriesRequest(
            model_id="model-1",
            model_version_id="ver-1",
            **{"from": base, "to": base + timedelta(hours=1)},
        ),
    )

    assert result == {"points": [], "truncated": False}


def test_series_truncates_at_the_cap_rather_than_silently_returning_partial():
    store = RecordingStore()
    base = datetime(2026, 9, 3, 8, 0, tzinfo=timezone.utc)
    original_cap = prediction_log_service.PREDICTION_LOG_SERIES_CAP
    prediction_log_service.PREDICTION_LOG_SERIES_CAP = 3
    try:
        prediction_log_service.append(store, _append_request(base, n_rows=5))
        result = prediction_log_service.series(
            store,
            PredictionLogSeriesRequest(
                model_id="model-1",
                model_version_id="ver-1",
                **{"from": base, "to": base + timedelta(hours=1)},
            ),
        )
        assert result["truncated"] is True
        assert len(result["points"]) == 3
    finally:
        prediction_log_service.PREDICTION_LOG_SERIES_CAP = original_cap
