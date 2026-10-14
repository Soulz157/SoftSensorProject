"""MODEL-SERVE-032-T03. `evaluation_frame`: a range read that persists nothing.

Runs the real shared builder (`_build_window_frame`) through the SQL path with
a faked query, so the fetch -> recipe -> trim code that `materialize_window`
also uses is exercised, not mocked away. Pins what differs for the Evaluation
page: Bad rows stay (flagged), a Bad cell is `null` never its 0.0 placeholder,
timestamps leave as UTC, and an oversized range fails before any fetch.
"""

from __future__ import annotations

import pytest

from schemas.preprocess import InferenceEvalFrameRequest
from services import inference_window_service as svc

SQL_CREDS = {"driver": "postgres", "host": "h", "port": 5432, "database": "d", "user": "u", "password": "p"}


class FakeStore:
    def __init__(self, spec=None):
        self.spec = spec if spec is not None else {"features": []}
        self.puts = 0

    def get_json(self, key):
        return self.spec

    def put_frame(self, *a, **k):  # evaluation_frame must never persist
        self.puts += 1
        raise AssertionError("evaluation_frame must not write")


def make_request(**over):
    base = dict(
        feature_spec_key="spec.json",
        feature_columns=["A", "B"],
        display_tags=["C"],
        # 07:00Z..07:05Z == 14:00..14:05 Bangkok wall clock
        window_start="2026-10-14T07:00:00.000Z",
        window_end="2026-10-14T07:05:00.000Z",
        interval="1m",
        sql={
            "query": {"credentials": SQL_CREDS, "table": "t"},
            "timestamp_column": "ts",
            "tags": ["A", "B", "C"],
        },
    )
    base.update(over)
    return InferenceEvalFrameRequest(**base)


def rows_payload(rows):
    return {"columns": ["ts", "A", "B", "C"], "rows": rows}


def stub_sql(monkeypatch, rows):
    seen = {}

    def fake_query(q):
        seen["q"] = q
        return rows_payload(rows)

    monkeypatch.setattr(svc._sql, "query", fake_query)
    return seen


def test_timestamps_leave_as_utc_not_bangkok_digits(monkeypatch):
    stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0}])
    out = svc.evaluation_frame(FakeStore(), make_request())
    assert out["rows"][0].timestamp == "2026-10-14T07:00:00.000Z"


def test_fetch_window_is_converted_to_wall_clock(monkeypatch):
    seen = stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0}])
    svc.evaluation_frame(FakeStore(), make_request())
    assert seen["q"].start_time.startswith("2026-10-14 14:00:00")
    assert seen["q"].end_time.startswith("2026-10-14 14:05:00")


def test_good_row_is_usable_and_carries_features_and_display_tags(monkeypatch):
    stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0}])
    out = svc.evaluation_frame(FakeStore(), make_request())
    row = out["rows"][0]
    assert row.usable is True
    assert {k: (c.value, c.status) for k, c in row.cells.items()} == {
        "A": (1.0, "Good"), "B": (2.0, "Good"), "C": (3.0, "Good"),
    }
    assert out["unusable_rows"] == 0


def test_bad_feature_row_is_kept_flagged_and_its_cell_is_null(monkeypatch):
    stub_sql(monkeypatch, [
        {"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0},
        {"ts": "2026-10-14 14:01:00", "A": None, "B": 2.0, "C": 3.0},  # hole -> Bad
    ])
    out = svc.evaluation_frame(FakeStore(), make_request())
    assert len(out["rows"]) == 2  # NOT dropped, unlike materialize_window
    bad = out["rows"][1]
    assert bad.usable is False
    assert bad.cells["A"].value is None and bad.cells["A"].status == "Bad"
    assert bad.cells["B"].value == 2.0
    assert out["unusable_rows"] == 1


def test_a_bad_display_tag_does_not_make_a_row_unusable(monkeypatch):
    stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": None}])
    out = svc.evaluation_frame(FakeStore(), make_request())
    row = out["rows"][0]
    assert row.usable is True  # C is for the trend panel only
    assert row.cells["C"].value is None


def test_nothing_is_persisted(monkeypatch):
    stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0}])
    store = FakeStore()
    svc.evaluation_frame(store, make_request())
    assert store.puts == 0


def test_oversized_range_fails_before_any_fetch(monkeypatch):
    def boom(q):
        raise AssertionError("must not fetch")

    monkeypatch.setattr(svc._sql, "query", boom)
    req = make_request(window_end="2026-10-15T07:00:00.000Z", max_rows=100)  # 1440 rows
    with pytest.raises(ValueError, match="Narrow the range"):
        svc.evaluation_frame(FakeStore(), req)


def test_naive_window_is_refused(monkeypatch):
    monkeypatch.setattr(svc._sql, "query", lambda q: rows_payload([]))
    with pytest.raises(ValueError, match="UTC"):
        svc.evaluation_frame(FakeStore(), make_request(window_start="2026-10-14 07:00:00"))


def test_inverted_window_is_refused(monkeypatch):
    monkeypatch.setattr(svc._sql, "query", lambda q: rows_payload([]))
    with pytest.raises(ValueError, match="after"):
        svc.evaluation_frame(
            FakeStore(),
            make_request(window_start="2026-10-14T08:00:00Z", window_end="2026-10-14T07:00:00Z"),
        )


def test_missing_feature_column_is_a_clear_error(monkeypatch):
    stub_sql(monkeypatch, [{"ts": "2026-10-14 14:00:00", "A": 1.0, "B": 2.0, "C": 3.0}])
    with pytest.raises(ValueError, match="feature column"):
        svc.evaluation_frame(FakeStore(), make_request(feature_columns=["A", "ZZ"]))


def test_rows_outside_the_window_are_trimmed(monkeypatch):
    stub_sql(monkeypatch, [
        {"ts": "2026-10-14 13:59:00", "A": 9.0, "B": 9.0, "C": 9.0},  # before
        {"ts": "2026-10-14 14:02:00", "A": 1.0, "B": 2.0, "C": 3.0},
        {"ts": "2026-10-14 14:05:00", "A": 9.0, "B": 9.0, "C": 9.0},  # == end, half-open
    ])
    out = svc.evaluation_frame(FakeStore(), make_request())
    assert [r.timestamp for r in out["rows"]] == ["2026-10-14T07:02:00.000Z"]


def test_both_sources_or_neither_is_refused():
    with pytest.raises(ValueError):
        make_request(sql=None)


def test_route_is_registered_and_maps_a_range_error_to_422(monkeypatch):
    from fastapi.testclient import TestClient

    from dependencies import get_object_store
    from main import app

    app.dependency_overrides[get_object_store] = lambda: FakeStore()
    try:
        r = TestClient(app).post("/v1/preprocess/evaluation-frame", json={
            "feature_spec_key": "spec.json",
            "feature_columns": ["A"],
            "window_start": "2026-10-14T00:00:00Z",
            "window_end": "2026-11-14T00:00:00Z",
            "interval": "1m",
            "sql": {"query": {"credentials": SQL_CREDS, "table": "t"}, "timestamp_column": "ts"},
        })
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 422
    assert "Narrow the range" in r.text
