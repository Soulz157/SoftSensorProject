"""MODEL-SERVE-032-T03. PI recorded read + write, offline.

A fake stands in for the SDK client, so these pin OUR behaviour: what is sent
(explicit updateOption / bufferOption, UTC stamps, no value on Remove), what is
reported back (per-item results, never more than PI said) and that a naive
timestamp is refused at the schema edge. They cannot prove PI stores anything
-- that is the live sandbox check, MODEL-SERVE-032-T11.
"""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from intergrations.aveva_connect import PIWebAPI
from schemas.data_source import PIRecordedRequest, PIWriteRequest
from services import data_source_service

CREDS = {"api_server": "https://pi.example", "pi_server": "PISRV", "user": "u", "password": "p"}


class FakeStream:
    def __init__(self, recorded=None, write_response=None, write_error=None):
        self.recorded = recorded or []
        self.write_response = write_response
        self.write_error = write_error
        self.get_calls: list[dict] = []
        self.write_calls: list[dict] = []

    def get_recorded(self, **kw):
        self.get_calls.append(kw)
        return NS(items=self.recorded)

    def update_values(self, **kw):
        self.write_calls.append(kw)
        if self.write_error:
            raise self.write_error
        return self.write_response


def make_api(stream: FakeStream, found: bool = True) -> PIWebAPI:
    api = PIWebAPI.__new__(PIWebAPI)  # skip the real SDK client
    api.pi_server = "PISRV"
    api.api_server = "https://pi.example"
    point = NS(web_id="WID1") if found else NS(web_id=None)
    api.client = NS(
        point=NS(get_by_path=lambda path: point),
        stream=stream,
    )
    return api


def ev(ts, value, good=True, questionable=False):
    return NS(timestamp=ts, value=value, good=good, questionable=questionable)


# ── connector: read ──────────────────────────────────────────────────────────

def test_recorded_numeric_good_event_passes_through():
    api = make_api(FakeStream(recorded=[ev("2026-10-14T00:00:00Z", 12.5)]))
    out = api.get_recorded_events("LAB.1", "2026-10-14T00:00:00.000Z", "2026-10-14T01:00:00.000Z")
    assert out == [{"timestamp": "2026-10-14T00:00:00Z", "value": 12.5, "good": True}]


def test_recorded_digital_state_is_not_a_number():
    state = {"Name": "I/O Timeout", "Value": 249, "IsSystem": True}
    api = make_api(FakeStream(recorded=[ev("2026-10-14T00:00:00Z", state, good=False)]))
    (e,) = api.get_recorded_events("LAB.1", "a", "b")
    assert e["value"] is None and e["good"] is False


def test_recorded_questionable_or_bad_flag_is_not_good_but_keeps_its_number():
    api = make_api(FakeStream(recorded=[
        ev("t1", 1.0, questionable=True),
        ev("t2", 2.0, good=False),
    ]))
    out = api.get_recorded_events("LAB.1", "a", "b")
    assert [(e["value"], e["good"]) for e in out] == [(1.0, False), (2.0, False)]


def test_recorded_never_returns_bool_or_nan_as_a_measurement():
    api = make_api(FakeStream(recorded=[ev("t1", True), ev("t2", float("nan"))]))
    out = api.get_recorded_events("LAB.1", "a", "b")
    assert all(e["value"] is None and e["good"] is False for e in out)


def test_recorded_asks_pi_for_inside_boundary_and_the_cap():
    stream = FakeStream()
    make_api(stream).get_recorded_events("LAB.1", "S", "E", max_count=77)
    kw = stream.get_calls[0]
    assert (kw["web_id"], kw["start_time"], kw["end_time"]) == ("WID1", "S", "E")
    assert kw["boundary_type"] == "Inside" and kw["max_count"] == 77


def test_unknown_tag_is_a_clear_error():
    api = make_api(FakeStream(), found=False)
    with pytest.raises(RuntimeError, match="not found"):
        api.get_recorded_events("NOPE", "a", "b")


# ── connector: write ─────────────────────────────────────────────────────────

def test_write_sends_explicit_options_and_values():
    stream = FakeStream()
    res = make_api(stream).write_recorded(
        "OUT.PRED", [("2026-10-14T00:00:00.000Z", 1.5), ("2026-10-14T00:01:00.000Z", 2.5)]
    )
    (call,) = stream.write_calls
    assert call["update_option"] == "Replace"
    assert call["buffer_option"] == "DoNotBuffer"  # never the server default
    assert [(v.timestamp, v.value) for v in call["values"]] == [
        ("2026-10-14T00:00:00.000Z", 1.5),
        ("2026-10-14T00:01:00.000Z", 2.5),
    ]
    assert [r["ok"] for r in res] == [True, True]  # empty body = no objection


def test_remove_sends_timestamps_without_values():
    stream = FakeStream()
    make_api(stream).write_recorded("OUT.PRED", [("2026-10-14T00:00:00.000Z", None)], "Remove")
    (call,) = stream.write_calls
    assert call["update_option"] == "Remove"
    assert call["values"][0].value is None


def test_write_reads_per_item_substatus_from_a_207_body():
    resp = NS(items=[
        NS(substatus=200, message=None),
        NS(substatus=400, message="Value out of range"),
    ])
    res = make_api(FakeStream(write_response=resp)).write_recorded(
        "OUT.PRED", [("t1", 1.0), ("t2", 2.0)]
    )
    assert res == [
        {"timestamp": "t1", "ok": True, "error": None},
        {"timestamp": "t2", "ok": False, "error": "Value out of range"},
    ]


def test_write_ignores_a_misaligned_body_rather_than_guessing():
    resp = NS(items=[NS(substatus=500, message="boom")])  # 1 status for 2 points
    res = make_api(FakeStream(write_response=resp)).write_recorded("T", [("t1", 1.0), ("t2", 2.0)])
    assert [r["ok"] for r in res] == [True, True]


def test_write_chunks_large_batches():
    stream = FakeStream()
    pts = [(f"t{i}", float(i)) for i in range(1201)]
    res = make_api(stream).write_recorded("T", pts)
    assert [len(c["values"]) for c in stream.write_calls] == [500, 500, 201]
    assert len(res) == 1201 and res[1200]["timestamp"] == "t1200"


def test_a_transport_failure_raises_instead_of_reporting_partial_success():
    stream = FakeStream(write_error=RuntimeError("HTTP 503"))
    with pytest.raises(RuntimeError, match="503"):
        make_api(stream).write_recorded("T", [("t1", 1.0)])


def test_only_replace_and_remove_are_allowed():
    with pytest.raises(ValueError):
        make_api(FakeStream()).write_recorded("T", [("t1", 1.0)], "Insert")


# ── schema edge: UTC only ────────────────────────────────────────────────────

def test_naive_timestamp_is_refused_at_the_edge():
    with pytest.raises(ValidationError, match="UTC instant"):
        PIRecordedRequest(credentials=CREDS, tag="T",
                          start_time="2026-10-14 07:00:00", end_time="2026-10-14T08:00:00Z")


def test_offset_timestamp_is_normalised_to_utc_z():
    body = PIWriteRequest(credentials=CREDS, tag="T",
                          points=[{"timestamp": "2026-10-14T07:00:00+07:00", "value": 1.0}])
    assert body.points[0].timestamp == "2026-10-14T00:00:00.000Z"


def test_replace_needs_values_and_no_nan_and_no_duplicates():
    ts = "2026-10-14T00:00:00Z"
    with pytest.raises(ValidationError):
        PIWriteRequest(credentials=CREDS, tag="T", points=[{"timestamp": ts}])
    with pytest.raises(ValidationError):
        PIWriteRequest(credentials=CREDS, tag="T", points=[{"timestamp": ts, "value": float("nan")}])
    with pytest.raises(ValidationError, match="duplicate"):
        PIWriteRequest(credentials=CREDS, tag="T",
                       points=[{"timestamp": ts, "value": 1.0}, {"timestamp": "2026-10-14T00:00:00.000Z", "value": 2.0}])


def test_remove_needs_no_value():
    body = PIWriteRequest(credentials=CREDS, tag="T", update_option="Remove",
                          points=[{"timestamp": "2026-10-14T00:00:00Z"}])
    assert body.points[0].value is None


# ── round trip: what we write is what we read back, same instant ─────────────

class MemoryPI(FakeStream):
    """Stores Replace/Remove so write-then-read exercises the real UTC path."""

    def __init__(self):
        super().__init__()
        self.store: dict[str, float] = {}

    def update_values(self, **kw):
        for v in kw["values"]:
            if kw["update_option"] == "Replace":
                self.store[v.timestamp] = v.value
            else:
                self.store.pop(v.timestamp, None)

    def get_recorded(self, **kw):
        return NS(items=[ev(t, v) for t, v in sorted(self.store.items())])


def test_write_then_read_returns_the_same_utc_instant(monkeypatch):
    pi = MemoryPI()
    monkeypatch.setattr(data_source_service, "build_pi_client", lambda creds: make_api(pi))
    svc = data_source_service.PIDataSourceService()

    # 14:00 Bangkok wall clock == 07:00Z. The caller converts, PI sees 07:00Z.
    svc.write(PIWriteRequest(credentials=CREDS, tag="OUT", points=[{"timestamp": "2026-10-14T07:00:00Z", "value": 3.0}]))
    got = svc.recorded(PIRecordedRequest(credentials=CREDS, tag="OUT",
                                         start_time="2026-10-14T00:00:00Z", end_time="2026-10-14T23:59:59Z"))
    assert [(p.timestamp, p.value) for p in got.points] == [("2026-10-14T07:00:00.000Z", 3.0)]

    svc.write(PIWriteRequest(credentials=CREDS, tag="OUT", update_option="Remove", points=[{"timestamp": "2026-10-14T07:00:00Z"}]))
    gone = svc.recorded(PIRecordedRequest(credentials=CREDS, tag="OUT",
                                          start_time="2026-10-14T00:00:00Z", end_time="2026-10-14T23:59:59Z"))
    assert gone.points == []


# ── routes ───────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    from main import app
    pi = MemoryPI()
    monkeypatch.setattr(data_source_service, "build_pi_client", lambda creds: make_api(pi))
    return TestClient(app), pi


def test_write_route_round_trip(client):
    c, pi = client
    r = c.post("/v1/data-sources/pi/write", json={
        "credentials": CREDS, "tag": "OUT",
        "points": [{"timestamp": "2026-10-14T07:00:00Z", "value": 4.0}]})
    assert r.status_code == 200 and r.json()["results"][0]["ok"] is True
    r = c.post("/v1/data-sources/pi/recorded", json={
        "credentials": CREDS, "tag": "OUT",
        "start_time": "2026-10-14T00:00:00Z", "end_time": "2026-10-15T00:00:00Z"})
    assert r.json()["points"] == [{"timestamp": "2026-10-14T07:00:00.000Z", "value": 4.0, "good": True}]


def test_route_rejects_naive_timestamp_with_422(client):
    c, _ = client
    r = c.post("/v1/data-sources/pi/write", json={
        "credentials": CREDS, "tag": "OUT",
        "points": [{"timestamp": "2026-10-14 07:00:00", "value": 4.0}]})
    assert r.status_code == 422


def test_pi_failure_is_a_502_not_an_attribute_error(monkeypatch):
    # The old `from asyncio import log` made this path raise AttributeError.
    from main import app
    pi = FakeStream(write_error=RuntimeError("HTTP 503"))
    monkeypatch.setattr(data_source_service, "build_pi_client", lambda creds: make_api(pi))
    r = TestClient(app).post("/v1/data-sources/pi/write", json={
        "credentials": CREDS, "tag": "OUT",
        "points": [{"timestamp": "2026-10-14T07:00:00Z", "value": 1.0}]})
    assert r.status_code == 502 and r.json()["detail"] == "PI Web API error"


def test_resolve_tags_error_path_is_a_502(monkeypatch):
    from main import app
    import importlib

    data_source = importlib.import_module("routers.data_source")

    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(data_source._pi, "resolve_tags", boom)
    r = TestClient(app).post("/v1/data-sources/pi/tags/resolve", json={"credentials": CREDS, "tag_list": ["A"]})
    assert r.status_code == 502


# ── resolve_tags reports the point type (write-back config needs it) ─────────

def test_resolve_tags_returns_point_type_for_the_numeric_check():
    point = NS(identifier="\\\\PISRV\\OUT.PRED", object=NS(web_id="W1", point_type="Float32"))
    digital = NS(identifier="\\\\PISRV\\STATE", object=NS(web_id="W2", point_type="Digital"))
    api = PIWebAPI.__new__(PIWebAPI)
    api.pi_server = "PISRV"
    api.client = NS(
        point=NS(get_multiple=lambda path, include_mode: NS(items=[point, digital])),
        streamSet=NS(get_values_ad_hoc=lambda **kw: NS(items=[])),
    )
    out = api.resolve_tags(["OUT.PRED", "STATE", "MISSING"])
    assert out["OUT.PRED"]["point_type"] == "Float32"
    assert out["STATE"]["point_type"] == "Digital"
    assert out["MISSING"] is None


def test_resolve_route_exposes_point_type(monkeypatch):
    from main import app

    class FakeApi:
        def resolve_tags(self, names):
            return {"OUT.PRED": {"web_id": "W1", "point_type": "Float32"}, "NOPE": None}

    monkeypatch.setattr(data_source_service, "build_pi_client", lambda creds: FakeApi())
    r = TestClient(app).post("/v1/data-sources/pi/tags/resolve", json={"credentials": CREDS, "tag_list": ["OUT.PRED", "NOPE"]})
    assert r.status_code == 200
    tags = {t["tagName"]: t for t in r.json()["tags"]}
    assert tags["OUT.PRED"]["pointType"] == "Float32" and tags["OUT.PRED"]["exists"] is True
    assert tags["NOPE"]["exists"] is False and tags["NOPE"]["pointType"] is None
