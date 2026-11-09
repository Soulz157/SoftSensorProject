"""MODEL-SERVE-036. `build_input_series` — trend, per-window stats and
out-of-range counts from the window input Parquet, counted with the same
bucket primitive as the window histograms."""

from __future__ import annotations

import io

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    status_column,
)
from schemas.preprocess import InferenceWindowInputSeriesRequest
from services.input_series_service import build_input_series
from softsensor_scaling import bucket_histogram

TAG = "TI202.PV"
VALVE = "FIC107R.PV"
EDGES = [10.0, 12.0, 14.0, 16.0, 18.0, 20.0]


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, frame: pd.DataFrame) -> None:
        buf = io.BytesIO()
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), buf)
        self.objects[key] = buf.getvalue()

    def get_frame(self, key, columns=None):
        return pq.read_table(
            pa.BufferReader(self.objects[key]), columns=columns
        ).to_pandas()


def _window_frame(start, tag_values, valve, bad_at=None):
    stamps = pd.date_range(start, periods=len(tag_values), freq="1min")
    status = [STATUS_GOOD] * len(tag_values)
    if bad_at is not None:
        status[bad_at] = STATUS_BAD
    return pd.DataFrame(
        {
            TIMESTAMP_COLUMN: stamps,
            TAG: tag_values,
            status_column(TAG): status,
            VALVE: valve,
            status_column(VALVE): [STATUS_GOOD] * len(valve),
        }
    )


def _request(windows, **over):
    body = {
        "windows": windows,
        "columns": [TAG, VALVE],
        "references": {
            TAG: {"edges": EDGES, "bin_mode": "continuous"},
            VALVE: {"edges": [0.0, 1.0, 2.0], "bin_mode": "categorical"},
        },
    }
    body.update(over)
    return InferenceWindowInputSeriesRequest(**body)


def _store_two_windows():
    store = Store()
    store.put(
        "w1",
        _window_frame("2026-10-19 13:00", [11.0, 9.0, 15.0, 21.0], [1.0, 2.2, 2.9, 0.0]),
    )
    store.put(
        "w2",
        _window_frame("2026-10-19 14:00", [12.0, 25.0, 13.0], [1.0, 1.0, 2.0], bad_at=1),
    )
    windows = [
        {
            "key": "w1",
            "window_start": "2026-10-19T06:00:00.000Z",
            "window_end": "2026-10-19T07:00:00.000Z",
        },
        {
            "key": "w2",
            "window_start": "2026-10-19T07:00:00.000Z",
            "window_end": "2026-10-19T08:00:00.000Z",
        },
    ]
    return store, windows


def test_counts_match_the_window_histogram_primitive():
    store, windows = _store_two_windows()
    out = build_input_series(store, _request(windows))["columns"]

    tag = out[TAG]
    # 9.0 below, 21.0 above; the Bad 25.0 cell is skipped.
    assert (tag["below"], tag["above"], tag["total"]) == (1, 1, 6)
    expected = bucket_histogram(
        pd.Series([11.0, 9.0, 15.0, 21.0, 12.0, 13.0]).to_numpy(), EDGES, "continuous"
    )
    assert tag["counts"] == expected["counts"]

    # Categorical half-gap tolerance: 2.2 matches state 2, 2.9 is above.
    valve = out[VALVE]
    assert (valve["below"], valve["above"]) == (0, 1)


def test_windows_newest_first_with_their_own_stats():
    store, windows = _store_two_windows()
    tag = build_input_series(store, _request(windows))["columns"][TAG]
    assert [w["window_start"] for w in tag["windows"]] == [
        "2026-10-19T07:00:00.000Z",
        "2026-10-19T06:00:00.000Z",
    ]
    newest = tag["windows"][0]
    assert (newest["n"], newest["min"], newest["max"]) == (2, 12.0, 13.0)
    assert sum(w["below"] + w["above"] for w in tag["windows"]) == (
        tag["below"] + tag["above"]
    )


def test_raw_points_are_utc_and_mark_out_of_range_rows():
    store, windows = _store_two_windows()
    tag = build_input_series(store, _request(windows))["columns"][TAG]
    assert tag["resolution"] == "raw"
    # Frame stamps are Bangkok wall clock (UTC+7).
    assert tag["points"][0]["t"] == "2026-10-19T06:00:00.000Z"
    assert [p["out_of_range"] for p in tag["points"]] == [0, 1, 0, 1, 0, 0]
    assert tag["last_out_of_range_at"] == "2026-10-19T06:03:00.000Z"


def test_bucketing_keeps_spikes():
    store = Store()
    values = [15.0] * 120
    values[37] = 30.0
    store.put("w", _window_frame("2026-10-19 13:00", values, [1.0] * 120))
    req = _request(
        [{"key": "w", "window_start": "a", "window_end": "b"}], max_points=50
    )
    tag = build_input_series(store, req)["columns"][TAG]
    assert tag["resolution"] == "bucketed"
    assert tag["bucket_minutes"] == 5
    assert len(tag["points"]) <= 50
    assert max(p["max"] for p in tag["points"]) == 30.0
    assert sum(p["out_of_range"] for p in tag["points"]) == 1


def test_missing_key_and_column_without_reference():
    store, windows = _store_two_windows()
    windows.append({"key": "gone", "window_start": "c", "window_end": "d"})
    result = build_input_series(store, _request(windows, references={}))
    assert result["missing"] == 1
    tag = result["columns"][TAG]
    assert tag["counts"] is None
    assert (tag["below"], tag["above"]) == (0, 0)
    assert tag["live_max"] == 21.0


def test_empty_columns_discovers_feature_columns_from_the_frames():
    store, windows = _store_two_windows()
    result = build_input_series(store, _request(windows, columns=[]))
    assert list(result["columns"]) == [TAG, VALVE]
