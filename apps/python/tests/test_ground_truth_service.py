"""MODEL-SERVE-005-T03. The join's own semantics, in isolation from any
source: tolerance, one-pair-per-prediction, never-impute, and the two
distinct "nothing to report" states.

The arithmetic assertions are hand-computed in the test body rather than
recomputed with the same expression the service uses — a test that mirrors
the implementation proves only that the code is self-consistent.
"""

import io

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from intergrations.object_store import (
    INFERENCE_TRUTH_FILENAME,
    STATUS_BAD,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    is_inference_window_key,
    status_column,
)
from schemas.data_source import PICredentials, PIFetchRequest
from schemas.preprocess import InferenceWindowTruthJoinRequest
from services import ground_truth_service

TAG = "LAB001.lab"
PREDICTIONS_KEY = "inference/model-1/ver-1/dt=2026-09-14/hour=15/predictions.parquet"


class RecordingStore:
    """In-memory ObjectStore stand-in — the same pattern
    tests/test_prediction_log_service.py already uses. Only implements what
    `ground_truth_service` calls: `get_frame`, `put_object_bytes`.
    """

    def __init__(self) -> None:
        self.raw_objects: dict[str, bytes] = {}

    def put_object_bytes(
        self, key, data, *, content_type="application/octet-stream", tags=None
    ):
        self.raw_objects[key] = data

    def get_frame(self, key, columns=None):
        table = pq.read_table(pa.BufferReader(self.raw_objects[key]), columns=columns)
        return table.to_pandas()


def _write_predictions(store: RecordingStore, rows: list[tuple[str, float]]) -> None:
    frame = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.to_datetime([ts for ts, _ in rows]),
            "prediction": [value for _, value in rows],
        }
    )
    buffer = io.BytesIO()
    pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), buffer)
    store.raw_objects[PREDICTIONS_KEY] = buffer.getvalue()


def _truth_frame(rows: list[tuple[str, float, int]]) -> pd.DataFrame:
    """Canonical frame shape: timestamp + tag + its status sidecar."""
    return pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.to_datetime([ts for ts, _, _ in rows]),
            TAG: [value for _, value, _ in rows],
            status_column(TAG): [status for _, _, status in rows],
        }
    )


def _request(tolerance_seconds: int = 1800) -> InferenceWindowTruthJoinRequest:
    # 08:00Z is 15:00 Bangkok wall-clock, which is what every frame in this
    # system stores (frame_service's own convention) — so the fixtures below
    # are written at 15:00, not 08:00.
    return InferenceWindowTruthJoinRequest(
        predictions_key=PREDICTIONS_KEY,
        target_column=TAG,
        model_id="model-1",
        model_version_id="ver-1",
        dt="2026-09-14",
        hour="15",
        window_start="2026-09-14T08:00:00.000Z",
        window_end="2026-09-14T09:00:00.000Z",
        tolerance_seconds=tolerance_seconds,
        sql={
            "query": {
                "credentials": {
                    "driver": "postgres",
                    "host": "localhost",
                    "port": 5432,
                    "database": "db",
                    "user": "u",
                    "password": "p",
                },
                "table": "lab",
                "columns": [TAG],
                "time_column": "ts",
                "start_time": "2026-09-14 15:00:00",
                "end_time": "2026-09-14 16:00:00",
            },
            "timestamp_column": "ts",
            "tags": [TAG],
        },
    )


def _patch_truth(monkeypatch, frame: pd.DataFrame) -> None:
    monkeypatch.setattr(
        ground_truth_service, "_fetch_truth_frame", lambda *_args, **_kw: frame
    )


def test_no_lab_sample_reports_no_error_rather_than_an_error_of_zero(monkeypatch):
    """The case that separates a working join from one that has merely not
    been fed: a window whose range holds no lab sample must come back with
    n = 0, no object, and must NOT be readable as a perfect score."""
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 40.0)])
    _patch_truth(monkeypatch, _truth_frame([]))

    result = ground_truth_service.join_window_truth(store, _request())

    assert result["n"] == 0
    assert result["truth_rows"] == 0
    assert result["paired_rows"] == 0
    assert result["object_key"] is None
    assert result["checksum"] is None
    # Predictions still counted — "no truth" and "no predictions" are
    # different states and must stay distinguishable.
    assert result["prediction_rows"] == 1
    assert set(store.raw_objects) == {PREDICTIONS_KEY}


def test_bad_status_truth_is_dropped_never_imputed(monkeypatch):
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 40.0)])
    _patch_truth(monkeypatch, _truth_frame([("2026-09-14 15:00:00", 99.0, STATUS_BAD)]))

    result = ground_truth_service.join_window_truth(store, _request())

    assert result["truth_rows"] == 0
    assert result["n"] == 0


def test_truth_arrived_but_nothing_within_tolerance_is_its_own_state(monkeypatch):
    """truth_rows > 0 with paired_rows == 0 is real and different from no
    truth at all: the lab reported, but not near a scored row."""
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 40.0)])
    # 40 minutes away, tolerance 30 minutes.
    _patch_truth(
        monkeypatch, _truth_frame([("2026-09-14 15:40:00", 41.0, STATUS_GOOD)])
    )

    result = ground_truth_service.join_window_truth(store, _request(1800))

    assert result["truth_rows"] == 1
    assert result["paired_rows"] == 0
    assert result["n"] == 0
    assert result["object_key"] is None


def test_sample_just_inside_tolerance_pairs_and_the_sums_are_exact(monkeypatch):
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])
    # 29 minutes away — inside a 30-minute tolerance.
    _patch_truth(
        monkeypatch, _truth_frame([("2026-09-14 15:29:00", 40.0, STATUS_GOOD)])
    )

    result = ground_truth_service.join_window_truth(store, _request(1800))

    # residual = predicted - actual = 41 - 40 = +1, hand-computed.
    assert result["n"] == 1
    assert result["paired_rows"] == 1
    assert result["sum_signed"] == pytest.approx(1.0)
    assert result["sum_se"] == pytest.approx(1.0)
    assert result["sum_ae"] == pytest.approx(1.0)
    assert result["sum_actual"] == pytest.approx(40.0)
    assert result["sum_actual_sq"] == pytest.approx(1600.0)


def test_the_pairs_object_lands_in_the_window_s_own_prefix(monkeypatch):
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])
    _patch_truth(
        monkeypatch, _truth_frame([("2026-09-14 15:00:00", 40.0, STATUS_GOOD)])
    )

    result = ground_truth_service.join_window_truth(store, _request())

    key = result["object_key"]
    assert key.endswith(f"/{INFERENCE_TRUTH_FILENAME}")
    assert key.startswith("inference/model-1/ver-1/dt=2026-09-14/hour=15/")
    assert is_inference_window_key(key)

    written = store.get_frame(key)
    assert list(written.columns) == [TIMESTAMP_COLUMN, "predicted", "actual", "residual"]
    assert written["residual"].iloc[0] == pytest.approx(1.0)


def test_several_lab_samples_snapping_to_one_prediction_keep_only_the_closest(
    monkeypatch,
):
    """Otherwise a lab instrument sampling faster than the scoring cadence
    weights that one prediction several times in the pooled metric."""
    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])
    _patch_truth(
        monkeypatch,
        _truth_frame(
            [
                ("2026-09-14 15:02:00", 40.0, STATUS_GOOD),  # closest
                ("2026-09-14 15:20:00", 30.0, STATUS_GOOD),
            ]
        ),
    )

    result = ground_truth_service.join_window_truth(store, _request(1800))

    assert result["truth_rows"] == 2
    assert result["paired_rows"] == 1
    assert result["n"] == 1
    # The 40.0 sample won, not the 30.0 one: residual = 41 - 40 = 1.
    assert result["sum_actual"] == pytest.approx(40.0)
    assert result["sum_signed"] == pytest.approx(1.0)


def test_a_re_join_with_more_truth_rewrites_the_same_key_with_more_pairs(monkeypatch):
    """Truth is incremental. The second join must REPLACE the object, not
    write beside it, and must report the larger n."""
    store = RecordingStore()
    _write_predictions(
        store,
        [
            ("2026-09-14 15:00:00", 41.0),
            ("2026-09-14 15:30:00", 42.0),
            ("2026-09-14 15:50:00", 43.0),
        ],
    )

    _patch_truth(
        monkeypatch, _truth_frame([("2026-09-14 15:00:00", 40.0, STATUS_GOOD)])
    )
    first = ground_truth_service.join_window_truth(store, _request(600))
    assert first["n"] == 1
    assert len(store.raw_objects) == 2  # predictions + truth

    _patch_truth(
        monkeypatch,
        _truth_frame(
            [
                ("2026-09-14 15:00:00", 40.0, STATUS_GOOD),
                ("2026-09-14 15:30:00", 40.0, STATUS_GOOD),
                ("2026-09-14 15:50:00", 40.0, STATUS_GOOD),
            ]
        ),
    )
    second = ground_truth_service.join_window_truth(store, _request(600))

    assert second["n"] == 3
    assert second["object_key"] == first["object_key"]
    assert len(store.raw_objects) == 2  # still one truth object, rewritten
    assert len(store.get_frame(second["object_key"])) == 3


# ── The PI branch's held-value refusal ───────────────────────────────────


def _pi_request() -> InferenceWindowTruthJoinRequest:
    base = _request()
    return InferenceWindowTruthJoinRequest(
        **{
            **base.model_dump(exclude={"sql", "pi"}),
            "pi": PIFetchRequest(
                credentials=PICredentials(
                    api_server="https://pi.invalid",
                    pi_server="PI",
                    user="u",
                    password="p",
                ),
                tag_list=["ignored"],
                start_time="2026-09-14 15:00:00.000000",
                end_time="2026-09-14 16:00:00.000000",
                summary_duration="10m",
            ),
        }
    )


def test_pi_intervals_with_no_lab_event_are_refused_even_though_pi_returns_a_value(
    monkeypatch,
):
    """The trap this endpoint exists to avoid: PI holds a sparse .lab tag's
    last value between samples, so the VALUE call returns a plausible
    number for every interval. Only the intervals the COUNT probe saw an
    event in may be trusted."""
    calls: list[list[str]] = []

    async def fake_fetch(body, interval):
        calls.append([s.value if hasattr(s, "value") else s for s in body.summary_type])
        held = [
            {"timestamp": "2026-09-14 15:00:00", "value": 40.0},
            {"timestamp": "2026-09-14 15:10:00", "value": 40.0},  # held, no event
            {"timestamp": "2026-09-14 15:20:00", "value": 44.0},
        ]
        counts = [
            {"timestamp": "2026-09-14 15:00:00", "value": 1},
            {"timestamp": "2026-09-14 15:10:00", "value": 0},  # nothing measured
            {"timestamp": "2026-09-14 15:20:00", "value": 2},
        ]
        data = counts if calls[-1][0] == "Count" else held
        return {"results": [{"tag_name": TAG, "status": "ok", "data": data}]}

    monkeypatch.setattr(ground_truth_service._pi, "fetch", fake_fetch)

    store = RecordingStore()
    _write_predictions(
        store,
        [
            ("2026-09-14 15:00:00", 41.0),
            ("2026-09-14 15:10:00", 41.0),
            ("2026-09-14 15:20:00", 45.0),
        ],
    )

    result = ground_truth_service.join_window_truth(store, _pi_request())

    # Two calls, Count first — the probe decides before the value is read.
    assert [c[0] for c in calls] == ["Count", "Average"]
    # The held 15:10 interval is gone; the two real events remain.
    assert result["truth_rows"] == 2
    assert result["n"] == 2
    # residuals: (41-40) = 1 and (45-44) = 1 -> sum_se 2, sum_signed 2.
    assert result["sum_se"] == pytest.approx(2.0)
    assert result["sum_signed"] == pytest.approx(2.0)


def test_pi_branch_overrides_the_schedule_s_time_weighted_basis(monkeypatch):
    seen: list[str] = []

    async def fake_fetch(body, interval):
        basis = body.cal_basis
        seen.append(basis.value if hasattr(basis, "value") else basis)
        return {"results": [{"tag_name": TAG, "status": "ok", "data": []}]}

    monkeypatch.setattr(ground_truth_service._pi, "fetch", fake_fetch)

    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])

    # The request's own pi spec carries the schedule's default TimeWeighted.
    ground_truth_service.join_window_truth(store, _pi_request())

    assert seen == ["EventWeighted", "EventWeighted"]


# ── MODEL-SERVE-001-T18: a failed source must never look like a quiet lab ──
#
# The single defect this pair of tests exists to catch: `_fetch_truth_frame`
# used to build an empty-but-column-shaped frame from a DNS/timeout failure
# the exact same way it builds one from a lab that genuinely reported
# nothing — `join_window_truth` could not tell the two apart, so a broken
# source silently returned `_empty_result` and read on screen as "no lab
# measurement has arrived yet". Both tests must pass for the fix to be
# proven: one shows the failure case now raises, the other shows the
# healthy-empty case is UNCHANGED — a fix that also broke the honest empty
# state would be worse than the defect.

DNS_FAILURE_TEXT = (
    "HTTPSConnectionPool(host='scgc-piwebapi.scg.com', port=443): Max retries "
    "exceeded (Caused by NameResolutionError)"
)


def test_a_failed_pi_source_raises_with_the_verbatim_reason(monkeypatch):
    async def fake_fetch(body, interval):
        return {
            "results": [
                {
                    "tag_name": TAG,
                    "status": "failed",
                    "data": [],
                    "error": DNS_FAILURE_TEXT,
                }
            ]
        }

    monkeypatch.setattr(ground_truth_service._pi, "fetch", fake_fetch)

    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])

    with pytest.raises(ValueError, match="Could not read the source") as exc_info:
        ground_truth_service.join_window_truth(store, _pi_request())

    # Not paraphrased into a category — the connector's own words must be
    # readable in the raised message, since that message is what the
    # sweeper writes verbatim into `InferenceWindowTruth.failureReason`.
    assert DNS_FAILURE_TEXT in str(exc_info.value)


def test_a_healthy_but_quiet_pi_source_still_returns_an_honest_empty_result(
    monkeypatch,
):
    """The divergence proof: the SAME shape of response (empty), but with
    `status: "ok"` instead of `"failed"`, must NOT raise — this is cause
    (E), a lab that genuinely has not reported, and it is correct
    behaviour, not a defect to "fix" a second time."""

    async def fake_fetch(body, interval):
        return {"results": [{"tag_name": TAG, "status": "ok", "data": []}]}

    monkeypatch.setattr(ground_truth_service._pi, "fetch", fake_fetch)

    store = RecordingStore()
    _write_predictions(store, [("2026-09-14 15:00:00", 41.0)])

    result = ground_truth_service.join_window_truth(store, _pi_request())

    assert result["n"] == 0
    assert result["truth_rows"] == 0
