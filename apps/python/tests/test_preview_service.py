"""Guards for the preview path. The headline one is: preview never writes.

Why a fake store rather than live MinIO
---------------------------------------
The obvious version of the no-writes test lists the bucket before and after and
asserts the object count is unchanged. It has two problems. It needs MinIO, so
by the convention in `test_object_store.py` it must `pytest.skip` when storage
is down — and a guarantee that silently skips is the same failure shape as the
F0 `importorskip` that reported green while running zero assertions. And an
object-count check cannot see a DELETE: clearing a prefix leaves the count
lower, not higher, so the strictest reading of "no writes" would pass while the
source artifact was being removed.

So the store is faked, every mutating call raises, and the test always runs.
`test_the_guard_is_actually_armed` exists so the fake cannot rot into a mock
that absorbs `put_frame` and lets everything pass.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from schemas.preprocess import CleaningOperation, PreviewRequest
from services.cleaning_service import CleaningError
from services.preview_service import build_preview, column_stats

TS = pd.to_datetime(
    [
        "2026-06-22 00:00:00",
        "2026-06-22 00:01:00",
        "2026-06-22 00:02:00",
        "2026-06-22 00:03:00",
        "2026-06-22 00:04:00",
    ]
)


def source_frame() -> pd.DataFrame:
    """Five rows, one Bad cell on TI-101.

    The Bad cell holds `frame_service.MISSING_VALUE` (0.0), not NaN — that is
    the storage convention. It is chosen far below the Good values so a stat
    computed over all cells is numerically distinguishable from one computed
    over Good cells only.
    """
    return pd.DataFrame(
        {
            "timestamp": TS,
            "TI-101": [10.0, 0.0, 12.0, 13.0, 14.0],
            "TI-101__status": pd.array(
                [STATUS_GOOD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD],
                dtype="int8",
            ),
            "FI-404": [1.0, 2.0, 3.0, 4.0, 5.0],
            "FI-404__status": pd.array([STATUS_GOOD] * 5, dtype="int8"),
        }
    )


def three_tag_frame() -> pd.DataFrame:
    """V03 asks for '2 tags' returning 'only the requested subset' — that is
    unfalsifiable against a 2-tag source (2 of 2 proves nothing about
    subsetting), so this fixture exists specifically to have a third tag to
    exclude.
    """
    df = source_frame()
    df["PI-201"] = [100.0, 101.0, 102.0, 103.0, 104.0]
    df["PI-201__status"] = pd.array([STATUS_GOOD] * 5, dtype="int8")
    return df


def six_month_single_tag_frame(spike_at: int | None = None) -> pd.DataFrame:
    """V05's own scenario: one tag, six months, 1-minute interval — matching
    `tests/test_downsample.py::six_month_series` but shaped as a full 2N+1
    preview frame so it can go through `build_preview` end to end, not just
    the LTTB core."""
    periods = 6 * 30 * 24 * 60  # ~259,200 rows
    timestamps = pd.date_range("2026-01-01", periods=periods, freq="1min")
    values = 20.0 + 5.0 * np.sin(np.linspace(0, 200 * np.pi, periods))
    if spike_at is not None:
        values[spike_at] = 500.0
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "TI-101": values,
            "TI-101__status": pd.array([STATUS_GOOD] * periods, dtype="int8"),
        }
    )


class NoWriteStore:
    """Read-only stand-in for `ObjectStore`. Any mutation is a test failure.

    Deliberately NOT a MagicMock: a mock answers every attribute, so a service
    that called `put_frame` would be silently satisfied and this file would
    still be green. Here anything outside the read allowlist falls through to
    `__getattr__` and raises — which also means a write method added to
    `ObjectStore` in a later feature is caught without anyone remembering to
    update this class.
    """

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame
        self.reads: list[tuple[str, list[str] | None]] = []

    def get_frame(
        self, key: str, columns: list[str] | None = None
    ) -> pd.DataFrame:
        self.reads.append((key, columns))
        if columns is None:
            return self._frame.copy()
        # Mirrors pyarrow's real refusal (ArrowInvalid, a ValueError subclass)
        # so a test against this fake proves the same error class the
        # router's except-chain expects — same convention as
        # `test_artifact_service.RecordingStore.get_frame`.
        missing = [c for c in columns if c not in self._frame.columns]
        if missing:
            raise ValueError(f"No match for FieldRef.Name({missing[0]!r}) in schema")
        return self._frame[columns].copy()

    def __getattr__(self, name: str):
        raise AssertionError(
            f"preview called {name!r} on the object store. The preview path is "
            "read-only: it must not write, delete, or create anything."
        )


def request_for(source_key: str = "ds-1/v1.parquet", **overrides) -> PreviewRequest:
    payload: dict = {"source_key": source_key, "operations": [], "sample_rows": 5_000}
    payload.update(overrides)
    return PreviewRequest(**payload)


# ── the guarantee ────────────────────────────────────────────────────────


def test_the_guard_is_actually_armed() -> None:
    """Without this, a fake that quietly answers everything looks identical."""
    store = NoWriteStore(source_frame())
    with pytest.raises(AssertionError, match="read-only"):
        store.put_frame
    with pytest.raises(AssertionError, match="read-only"):
        store.delete_prefix


def test_preview_writes_nothing() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(
        store,
        request_for(
            operations=[
                CleaningOperation(type="fill_missing", method="linear", tags=["*"]),
                CleaningOperation(type="drop_missing"),
            ]
        ),
    )
    # Reached the end, so no mutating attribute was touched on the way.
    assert result["before"]["row_count"] == 5
    assert store.reads == [("ds-1/v1.parquet", None)]  # no tags -> no projection


# ── sampling honesty ─────────────────────────────────────────────────────


def test_source_row_count_is_the_artifact_not_the_window() -> None:
    """The regression that makes `sampled` unfalsifiable.

    Reporting the window height as the source height tells the client "this is
    a sample" and then hands it a total equal to the sample, so it cannot show
    how much was left out.
    """
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for(sample_rows=2))

    assert result["sampled"] is True
    assert result["sampled_rows"] == 2
    assert result["source_row_count"] == 5
    assert result["before"]["row_count"] == 2


def test_artifact_that_fits_the_window_is_not_flagged_sampled() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for(sample_rows=5))

    assert result["sampled"] is False
    assert result["sampled_rows"] == 5
    assert result["source_row_count"] == 5
    assert result["warnings"] == []


def test_exactly_at_the_cap_is_not_sampled() -> None:
    """Boundary: 5 rows with a cap of 5 is the whole dataset, not a sample."""
    store = NoWriteStore(source_frame())
    assert build_preview(store, request_for(sample_rows=5))["sampled"] is False
    assert build_preview(store, request_for(sample_rows=4))["sampled"] is True


def test_row_removing_operations_warn_when_sampled() -> None:
    """`drop_missing` carries `method=None`.

    Matching on the raw `(type, method)` tuple against a set written with
    string methods would never match it, so the operation that moves
    `delta.row_count` — the headline number — would get only the generic
    sampling notice and no "the committed run may differ" warning.
    """
    store = NoWriteStore(source_frame())
    result = build_preview(
        store,
        request_for(sample_rows=2, operations=[CleaningOperation(type="drop_missing")]),
    )

    assert len(result["warnings"]) == 2
    assert "drop_missing" in result["warnings"][1]


def test_operations_insensitive_to_sampling_get_only_the_generic_warning() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(
        store,
        request_for(
            sample_rows=2,
            operations=[CleaningOperation(type="clip", min=0, max=100, tags=["*"])],
        ),
    )
    assert len(result["warnings"]) == 1


# ── bounded window: tags + time range (DS-LAKE-005B-A-T04) ───────────────


def test_tag_filter_projects_columns_the_other_tag_is_gone() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for(tags=["TI-101"]))

    assert store.reads == [
        ("ds-1/v1.parquet", ["timestamp", "TI-101", "TI-101__status"])
    ]
    assert result["before"]["column_count"] == 1
    assert all("FI-404" not in row["cells"] for row in result["before"]["rows"])


def test_unknown_preview_tag_is_rejected_not_silently_dropped() -> None:
    store = NoWriteStore(source_frame())
    with pytest.raises(ValueError):
        build_preview(store, request_for(tags=["NOPE"]))


def test_time_window_narrows_source_row_count_before_the_sample_cap() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(
        store,
        request_for(
            start_time="2026-06-22 00:01:00",
            end_time="2026-06-22 00:03:00",
            sample_rows=2,
        ),
    )

    # Window is 3 rows (00:01..00:03); sample_rows=2 caps it further.
    assert result["source_row_count"] == 3
    assert result["sampled"] is True
    assert result["sampled_rows"] == 2
    assert result["filtered"] is True
    assert result["start_time"] == "2026-06-22 00:01:00"
    assert result["end_time"] == "2026-06-22 00:03:00"


def test_v03_two_tags_plus_time_range_returns_only_the_requested_subset() -> None:
    """DS-LAKE-005B-A-T04-V03, verbatim: 2 tags AND a bounded time range in
    ONE request, against a 3-tag source, so PI-201 being absent actually
    proves subsetting rather than being the source's only tag anyway.
    """
    store = NoWriteStore(three_tag_frame())
    result = build_preview(
        store,
        request_for(
            tags=["TI-101", "FI-404"],
            start_time="2026-06-22 00:01:00",
            end_time="2026-06-22 00:03:00",
        ),
    )

    projected_columns = store.reads[0][1]
    assert projected_columns is not None
    assert set(projected_columns) == {
        "timestamp",
        "TI-101",
        "TI-101__status",
        "FI-404",
        "FI-404__status",
    }
    assert "PI-201" not in projected_columns

    for side in (result["before"], result["after"]):
        for row in side["rows"]:
            assert set(row["cells"]) == {"TI-101", "FI-404"}
        assert {c["tag"] for c in side["columns"]} == {"TI-101", "FI-404"}

    assert result["source_row_count"] == 3  # window is 00:01..00:03
    assert result["filtered"] is True
    # The no-write half of V03 is the NoWriteStore guard itself
    # (test_the_guard_is_actually_armed) plus test_preview_writes_nothing —
    # reaching this assertion at all means nothing outside get_frame was
    # called.


def test_sampling_warning_says_window_not_whole_dataset_when_filtered() -> None:
    """'the whole dataset' would be false once a tag/time filter narrows the
    view — the sample is the first N rows of the WINDOW, not the artifact.
    """
    store = NoWriteStore(source_frame())

    unfiltered = build_preview(store, request_for(sample_rows=2))
    assert "the whole dataset" in unfiltered["warnings"][0]

    filtered = build_preview(
        store, request_for(sample_rows=1, start_time="2026-06-22 00:01:00")
    )
    assert "the requested window" in filtered["warnings"][0]
    assert "the whole dataset" not in filtered["warnings"][0]


def test_no_time_window_is_not_flagged_filtered() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for())

    assert result["filtered"] is False
    assert result["start_time"] is None
    assert result["end_time"] is None


# ── statistics ───────────────────────────────────────────────────────────


def test_column_stats_ignore_non_good_cells() -> None:
    """Bad cells hold the 0.0 hole; counting them drags every mean toward zero."""
    stats = column_stats(source_frame(), "TI-101")

    assert stats["count"] == 5  # rows in the frame
    assert stats["missing"] == 1
    assert stats["mean"] == 12.25  # (10+12+13+14)/4, NOT 9.8 over all five
    assert stats["min"] == 10.0  # the 0.0 hole is not the minimum
    assert stats["max"] == 14.0


def test_column_stats_of_an_all_bad_column_are_null_not_zero() -> None:
    """`None` says "unknown"; `0.0` would read as a real measurement."""
    frame = source_frame()
    frame["TI-101__status"] = pd.array([STATUS_BAD] * 5, dtype="int8")

    stats = column_stats(frame, "TI-101")
    assert stats["missing_pct"] == 100.0
    assert stats["mean"] is None
    assert stats["min"] is None
    assert stats["std"] is None
    assert stats["percentiles"] is None


def test_column_stats_percentiles_reflect_the_current_frame_not_a_snapshot() -> None:
    """DS-LAKE-005B-B-T01 edit 3: this IS the "recompute under current rules"
    mode — it runs over whatever frame the caller (e.g. a live crop/exclusion
    preview) just produced, not a committed-artifact-time snapshot like
    `column_stats_service.build_column_stats`. Proven by showing the
    percentiles genuinely differ when the frame changes, not just that the
    key exists."""
    stats_full = column_stats(source_frame(), "TI-101")
    assert stats_full["percentiles"] is not None
    assert set(stats_full["percentiles"].keys()) == {
        "p1", "p5", "p10", "p20", "p80", "p90", "p95", "p99",
    }

    # Same tag, a DIFFERENT frame (as a live crop would produce) — the
    # recomputed percentiles must move with it, not stay pinned to the first
    # frame's population.
    narrowed = source_frame().iloc[:2]
    stats_narrowed = column_stats(narrowed, "TI-101")
    assert stats_narrowed["percentiles"] != stats_full["percentiles"]


def test_column_count_is_logical_tags_only() -> None:
    """The frame is 2N+1 physical columns; the client must be told N."""
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for())

    assert len(source_frame().columns) == 5
    assert result["before"]["column_count"] == 2
    assert result["delta"]["column_count"] == 0


def test_delta_reports_what_the_operations_changed() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(
        store, request_for(operations=[CleaningOperation(type="drop_missing")])
    )

    # One row carried the Bad cell, so dropping it removes the row and the hole.
    assert result["delta"]["row_count"] == -1
    assert result["delta"]["missing_cells"] == -1
    assert result["after"]["missing_cells"] == 0


def test_preview_rows_are_capped_independently_of_the_sample() -> None:
    store = NoWriteStore(source_frame())
    result = build_preview(store, request_for(sample_rows=5, preview_rows=2))

    # Stats span the whole 5-row window; only the rendered rows are trimmed.
    assert result["before"]["row_count"] == 5
    assert len(result["before"]["rows"]) == 2
    assert result["before"]["rows"][0]["cells"]["TI-101"]["status"] == "Good"
    assert result["before"]["rows"][1]["cells"]["TI-101"]["status"] == "Bad"


# ── T06: max_points / LTTB downsampling ─────────────────────────────────


def test_max_points_bypasses_the_sample_rows_head_cut() -> None:
    """V05: a local extremum past sample_rows' head cut is unreachable if the
    cut runs before LTTB does. sample_rows is deliberately left far below
    the window's true size (259,200 rows) — if the head cut still applied,
    a spike this far in would never enter the computation at all."""
    spike_at = 200_000  # well past any realistic sample_rows default
    store = NoWriteStore(six_month_single_tag_frame(spike_at=spike_at))

    result = build_preview(
        store, request_for(source_key="ds-1/v1.parquet", sample_rows=5_000, max_points=2_000)
    )

    assert result["sampled"] is False  # no head truncation occurred
    assert result["before"]["downsampled"] is True
    series_timestamps = {row["timestamp"] for row in result["before"]["series"]}
    spike_ts = six_month_single_tag_frame()["timestamp"].iloc[spike_at]
    assert spike_ts.isoformat(sep=" ") in series_timestamps


def test_v05_full_scenario_ratio_and_both_extrema_survive_end_to_end() -> None:
    """V05, literally, through the real `build_preview` pipeline — not the
    raw `lttb_indices` core `test_downsample.py` exercises. Two things no
    other test here checks together:

    1. The reported ratio matches the TRUE source length (259,200), not a
       post-sample-cut length. `sample_rows` is set far below the window on
       purpose, so sampling and downsampling both engage on one request —
       the specific interaction where a wrong denominator could hide.
    2. A spike AND a trough survive together, at the realistic scale, in
       the same response.
    """
    periods = 6 * 30 * 24 * 60  # 259,200 — matches six_month_single_tag_frame
    spike_at, trough_at = 90_000, 180_000
    frame = six_month_single_tag_frame()
    frame.loc[spike_at, "TI-101"] = 500.0
    frame.loc[trough_at, "TI-101"] = -500.0
    store = NoWriteStore(frame)

    result = build_preview(store, request_for(sample_rows=5_000, max_points=2_000))

    assert result["sampled"] is False  # full window entered downsampling
    series = result["before"]["series"]
    assert len(series) <= 2_000
    assert result["max_points"] == 2_000

    expected_ratio = round(periods / len(series), 4)
    assert result["before"]["downsample_ratio"] == expected_ratio

    series_timestamps = {row["timestamp"] for row in series}
    assert frame["timestamp"].iloc[spike_at].isoformat(sep=" ") in series_timestamps
    assert frame["timestamp"].iloc[trough_at].isoformat(sep=" ") in series_timestamps


def test_series_respects_the_max_points_ceiling() -> None:
    store = NoWriteStore(six_month_single_tag_frame())
    result = build_preview(store, request_for(max_points=1_500))

    assert len(result["before"]["series"]) <= 1_500
    assert len(result["after"]["series"]) <= 1_500
    assert result["max_points"] == 1_500
    assert result["bucket_edges"] is not None
    assert result["before"]["downsample_ratio"] is not None


def test_rows_table_is_unaffected_by_max_points() -> None:
    """`rows`/`preview_rows` (the small table) must stay exactly what they
    were before T06 — `series` is an ADDITIONAL payload, not a replacement.

    Uses the six-month fixture with `sample_rows` deliberately far below its
    259,200-row total, so the "without" branch actually engages the head
    cut — an earlier version used the 5-row `source_frame()` fixture with
    `sample_rows=5,000`, which never cut anything in either branch, so the
    bypass path this test names was never exercised.
    """
    store = NoWriteStore(six_month_single_tag_frame())
    without = build_preview(
        store, request_for(sample_rows=1_000, preview_rows=3)
    )
    with_downsampling = build_preview(
        store, request_for(sample_rows=1_000, preview_rows=3, max_points=3)
    )

    assert without["before"]["row_count"] == 1_000  # head cut engaged
    assert with_downsampling["before"]["row_count"] == 259_200  # bypass engaged
    assert without["before"]["rows"] == with_downsampling["before"]["rows"]


def test_window_over_the_downsample_ceiling_is_a_cleaning_error() -> None:
    """MAX_DOWNSAMPLE_WINDOW_ROWS bounds the max_points-bypass path
    regardless of max_points itself — a caller cannot dodge the ceiling by
    asking for very few points back."""
    from schemas.preprocess import MAX_DOWNSAMPLE_WINDOW_ROWS

    periods = MAX_DOWNSAMPLE_WINDOW_ROWS + 1
    timestamps = pd.date_range("2026-01-01", periods=periods, freq="1s")
    frame = pd.DataFrame(
        {
            "timestamp": timestamps,
            "TI-101": [1.0] * periods,
            "TI-101__status": pd.array([STATUS_GOOD] * periods, dtype="int8"),
        }
    )
    store = NoWriteStore(frame)

    with pytest.raises(ValueError, match="capped at"):
        build_preview(store, request_for(sample_rows=5_000, max_points=100))


def test_v06_identity_recipe_downsamples_before_and_after_identically() -> None:
    """T06's core guarantee: an identity recipe (zero operations — after IS
    before) must downsample to the IDENTICAL series on both sides. Any diff
    here could only be introduced by the sampler picking different points
    for before vs after, which is exactly what the shared bucket-edges
    design exists to make impossible.
    """
    store = NoWriteStore(six_month_single_tag_frame(spike_at=90_000))

    result = build_preview(
        store, request_for(operations=[], sample_rows=5_000, max_points=1_200)
    )

    assert result["delta"]["row_count"] == 0  # confirms this really was a no-op
    assert result["before"]["series"] == result["after"]["series"]
    assert result["before"]["downsample_ratio"] == result["after"]["downsample_ratio"]


def test_row_removing_op_narrows_after_but_still_buckets_against_before_edges() -> None:
    """The actually discriminating case for V06's shared-basis claim.

    An earlier version of this test ran `drop_missing` against a fixture
    with zero Bad cells — it removed nothing, so "both sides report the same
    bucket_edges" was true under ANY implementation, including one where
    each side wrongly derived its own edges from an identical (because
    unchanged) span. That proved nothing about sharing.

    Here the trailing 30% of the window is marked Bad, so `after` is both
    shorter AND meaningfully narrower in time span than `before`. Under
    WRONG per-side edges, after's compressed span would be rebucketed into
    the same bucket COUNT over a narrower range — consecutive after-picks
    would then land closer together in time than a before-bucket is wide,
    and mapping them onto before's (wider) edges would show two picks
    colliding into the same before-bucket. Under the actual shared-edges
    design, after's own `lttb_indices` call is given before's edges
    directly, so at most one point can land in each before-bucket by
    construction — collisions are the falsifiable signal.
    """
    frame = six_month_single_tag_frame()
    total = len(frame)
    cutoff = int(total * 0.7)
    status = frame["TI-101__status"].to_numpy().copy()
    status[cutoff:] = STATUS_BAD
    frame["TI-101__status"] = pd.array(status, dtype="int8")
    store = NoWriteStore(frame)

    result = build_preview(
        store,
        request_for(
            operations=[CleaningOperation(type="drop_missing")],
            sample_rows=5_000,
            max_points=1_000,
        ),
    )

    edges = result["bucket_edges"]
    assert edges is not None
    before_span = pd.Timestamp(edges[-1]) - pd.Timestamp(edges[0])
    after_series = result["after"]["series"]
    after_span = pd.Timestamp(after_series[-1]["timestamp"]) - pd.Timestamp(
        after_series[0]["timestamp"]
    )
    # Confirms the scenario actually narrowed the span — otherwise the
    # collision check below would pass vacuously.
    assert after_span < before_span * 0.8

    edge_array = np.array([np.datetime64(e) for e in edges])
    after_timestamps = np.array(
        [np.datetime64(row["timestamp"]) for row in after_series]
    )
    # The two forced endpoints (first/last kept regardless of bucket) are
    # not part of the one-per-bucket guarantee — excluded from the check.
    interior = after_timestamps[1:-1]
    bucket_ids = np.searchsorted(edge_array, interior, side="right") - 1
    bucket_ids = np.clip(bucket_ids, 0, len(edge_array) - 2)

    assert len(bucket_ids) == len(set(bucket_ids.tolist())), (
        "after.series points collided into the same before-derived bucket — "
        "this is what per-side (unshared) bucket edges would produce, "
        "exactly the failure mode V06 exists to prevent."
    )


def test_downsample_warning_present_only_when_max_points_used() -> None:
    store = NoWriteStore(six_month_single_tag_frame())

    plain = build_preview(store, request_for())
    downsampled = build_preview(store, request_for(max_points=1_000))

    assert not any("downsampled" in w.lower() or "lttb" in w.lower() for w in plain["warnings"])
    assert any("lttb" in w.lower() for w in downsampled["warnings"])


# ── caller-fixable failures ──────────────────────────────────────────────


def test_unknown_column_is_a_cleaning_error() -> None:
    store = NoWriteStore(source_frame())
    with pytest.raises(CleaningError, match="unknown columns"):
        build_preview(
            store,
            request_for(
                operations=[CleaningOperation(type="drop_missing", tags=["NOPE-1"])]
            ),
        )


def test_unknown_operation_is_a_cleaning_error() -> None:
    store = NoWriteStore(source_frame())
    with pytest.raises(CleaningError):
        build_preview(
            store, request_for(operations=[CleaningOperation(type="teleport")])
        )


# ── router contract ──────────────────────────────────────────────────────
#
# The handler's except chain ends in `except Exception -> 502`. If a raised
# type ever stops matching an earlier clause, a caller-fixable mistake turns
# into a 502 with a server-side traceback and no actionable message — which
# still "errors", so a test that only asserted failure would not notice.
# Assert the status codes.


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from dependencies import get_object_store
    from main import app

    store = NoWriteStore(source_frame())
    app.dependency_overrides[get_object_store] = lambda: store
    try:
        yield TestClient(app), store
    finally:
        app.dependency_overrides.pop(get_object_store, None)


def test_route_returns_the_documented_shape(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/preview",
        json={
            "source_key": "ds-1/v1.parquet",
            "operations": [{"type": "drop_missing"}],
            "preview_rows": 5,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source_key"] == "ds-1/v1.parquet"
    assert body["sampled"] is False
    assert body["source_row_count"] == 5
    assert body["before"]["row_count"] == 5
    assert body["after"]["row_count"] == 4
    assert body["delta"]["row_count"] == -1


def test_unknown_operation_is_422_not_502(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/preview",
        json={"source_key": "ds-1/v1.parquet", "operations": [{"type": "teleport"}]},
    )
    assert response.status_code == 422


def test_unknown_column_is_422_not_502(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/preview",
        json={
            "source_key": "ds-1/v1.parquet",
            "operations": [{"type": "drop_missing", "tags": ["NOPE-1"]}],
        },
    )
    assert response.status_code == 422
    assert "NOPE-1" in response.json()["detail"]


def test_route_writes_nothing(client) -> None:
    """Same guarantee as `test_preview_writes_nothing`, through the HTTP layer.

    Worth repeating here because the router is where a future materialize or
    cache-the-result change would most plausibly be bolted on.
    """
    http, store = client
    response = http.post(
        "/v1/preprocess/preview",
        json={
            "source_key": "ds-1/v1.parquet",
            "operations": [{"type": "fill_missing", "method": "mean", "tags": ["*"]}],
        },
    )
    assert response.status_code == 200
    assert store.reads == [("ds-1/v1.parquet", None)]  # no tags -> no projection


def test_unknown_preview_tag_is_422_not_502(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/preview",
        json={
            "source_key": "ds-1/v1.parquet",
            "operations": [{"type": "drop_missing"}],
            "tags": ["NOPE"],
        },
    )
    assert response.status_code == 422


def test_time_window_reaches_the_response(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/preview",
        json={
            "source_key": "ds-1/v1.parquet",
            "operations": [{"type": "drop_missing"}],
            "start_time": "2026-06-22 00:01:00",
            "end_time": "2026-06-22 00:03:00",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["filtered"] is True
    assert body["source_row_count"] == 3
    assert body["start_time"] == "2026-06-22 00:01:00"
    assert body["end_time"] == "2026-06-22 00:03:00"
