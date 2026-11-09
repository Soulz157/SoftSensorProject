"""MODEL-SERVE-043. `materialize_window`'s lead-in for sequence models.

A sequence model (lstm/gru) scores row i from rows [i-L+1, i], so the first
row of an hourly window needs L-1 rows from BEFORE window_start. Those rows go
to context.parquet, never into input.parquet: every other reader of
input.parquet (the input drift series, the window's own counts and stats)
treats all of its rows as this window's data.

Same faked-SQL harness as test_evaluation_frame.py. 07:00Z..07:05Z is
14:00..14:05 Bangkok wall clock.
"""

from __future__ import annotations

from types import SimpleNamespace

from schemas.preprocess import InferenceWindowMaterializeRequest
from services import inference_window_service as svc

SQL_CREDS = {"driver": "postgres", "host": "h", "port": 5432, "database": "d", "user": "u", "password": "p"}


class RecordingStore:
    def __init__(self):
        self.frames: dict[str, object] = {}

    def get_json(self, key):
        return {"features": []}

    def put_frame(self, frame, key, overwrite=True):
        self.frames[key] = frame.copy()
        return SimpleNamespace(object_key=key, checksum=f"sha-{key}")


def make_request(**over):
    base = dict(
        feature_spec_key="spec.json",
        feature_columns=["A", "B"],
        model_id="m1",
        model_version_id="v1",
        dt="2026-10-14",
        hour="07",
        window_start="2026-10-14T07:00:00.000Z",
        window_end="2026-10-14T07:05:00.000Z",
        interval="1m",
        sql={
            "query": {"credentials": SQL_CREDS, "table": "t"},
            "timestamp_column": "ts",
            "tags": ["A", "B"],
        },
    )
    base.update(over)
    return InferenceWindowMaterializeRequest(**base)


def stub_sql(monkeypatch, minutes, bad_minute=None):
    """One row per wall-clock minute in `minutes` (e.g. range(55, 65) ->
    13:55..14:04). `bad_minute` gets a null A — a Bad cell."""
    seen = {}

    def fake_query(q):
        seen["q"] = q
        rows = []
        for m in minutes:
            hh, mm = 13 + m // 60, m % 60
            rows.append(
                {
                    "ts": f"2026-10-14 {hh:02d}:{mm:02d}:00",
                    "A": None if m == bad_minute else float(m),
                    "B": 1.0,
                }
            )
        return {"columns": ["ts", "A", "B"], "rows": rows}

    monkeypatch.setattr(svc._sql, "query", fake_query)
    return seen


def _key(name):
    return f"inference/m1/v1/dt=2026-10-14/hour=07/{name}"


def test_without_context_rows_nothing_changes(monkeypatch):
    seen = stub_sql(monkeypatch, range(55, 65))
    store = RecordingStore()
    out = svc.materialize_window(store, make_request())

    assert seen["q"].start_time.startswith("2026-10-14 14:00:00")
    assert list(store.frames) == [_key("input.parquet")]
    assert out["context_object_key"] is None and out["context_rows"] == 0
    assert out["row_count"] == 5


def test_context_rows_go_to_their_own_file(monkeypatch):
    seen = stub_sql(monkeypatch, range(55, 65))
    store = RecordingStore()
    out = svc.materialize_window(store, make_request(context_rows=3))

    # The fetch reaches back three more minutes than the window.
    assert seen["q"].start_time.startswith("2026-10-14 13:57:00")

    window = store.frames[_key("input.parquet")]
    context = store.frames[_key("context.parquet")]
    assert window["timestamp"].dt.strftime("%H:%M").tolist() == [
        "14:00", "14:01", "14:02", "14:03", "14:04",
    ]
    assert context["timestamp"].dt.strftime("%H:%M").tolist() == [
        "13:57", "13:58", "13:59",
    ]
    assert out["context_object_key"] == _key("context.parquet")
    assert out["context_checksum"] == f"sha-{_key('context.parquet')}"
    assert out["context_rows"] == 3


def test_window_figures_never_include_the_lead_in(monkeypatch):
    stub_sql(monkeypatch, range(55, 65))
    out = svc.materialize_window(RecordingStore(), make_request(context_rows=3))
    assert out["row_count"] == 5
    assert out["scored_rows"] == 5
    assert out["missing_pct"] == 0


def test_a_bad_lead_in_row_is_dropped_not_filled(monkeypatch):
    stub_sql(monkeypatch, range(55, 65), bad_minute=58)
    store = RecordingStore()
    out = svc.materialize_window(store, make_request(context_rows=3))
    context = store.frames[_key("context.parquet")]
    # 13:58 is gone; the gap is what the container sees and refuses to cross.
    assert context["timestamp"].dt.strftime("%H:%M").tolist() == ["13:57", "13:59"]
    assert out["context_rows"] == 2
    # The window's own figures are untouched by a Bad row outside it.
    assert out["missing_pct"] == 0


def test_no_lead_in_data_writes_no_context_file(monkeypatch):
    stub_sql(monkeypatch, range(60, 65))  # the source starts at 14:00
    store = RecordingStore()
    out = svc.materialize_window(store, make_request(context_rows=3))
    assert _key("context.parquet") not in store.frames
    assert out["context_object_key"] is None and out["context_rows"] == 0


class PresignStore:
    from datetime import timedelta as _td

    PRESIGN_READ_TTL = _td(minutes=15)

    def tag_retention(self, key):
        pass

    def presigned_get(self, key):
        return f"https://signed/{key}"

    def checksum_of(self, key):
        return "sha"


def test_the_lead_in_file_can_be_presigned_for_the_container():
    """Live 2026-11-02 (LSTM 3): materialize wrote context.parquet, but the
    presign allowlist only named input/predictions, so every lstm/gru claim
    400'd before the container ran. The harness above mocks the store, so
    nothing caught it until a real window was claimed."""
    from services import artifact_service

    out = artifact_service.presign_inference_window_object(
        PresignStore(), SimpleNamespace(source_key=_key("context.parquet"))
    )
    assert out["data_url"] == f"https://signed/{_key('context.parquet')}"


class FrameStore:
    def __init__(self, frame):
        self.frame = frame

    def get_frame(self, key):
        return self.frame


def test_last_prediction_is_the_newest_row_of_the_windows_predictions():
    """Run Predict for lstm/gru reports the window it dispatched: the newest
    row, whatever order the file holds them in."""
    import pandas as pd
    from services import artifact_service

    frame = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                ["2026-11-02 12:01", "2026-11-02 12:03", "2026-11-02 12:02"]
            ),
            "prediction": [1.0, 3.0, 2.0],
        }
    )
    out = artifact_service.last_inference_prediction(
        FrameStore(frame), SimpleNamespace(source_key=_key("predictions.parquet"))
    )
    assert out == {
        "timestamp": "2026-11-02T12:03:00",
        "prediction": 3.0,
        "row_count": 3,
    }


def test_last_prediction_refuses_any_other_file():
    import pytest
    from services import artifact_service

    with pytest.raises(ValueError, match="predictions.parquet"):
        artifact_service.last_inference_prediction(
            FrameStore(None), SimpleNamespace(source_key=_key("input.parquet"))
        )
