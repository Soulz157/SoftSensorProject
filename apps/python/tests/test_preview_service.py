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
        self.reads: list[tuple[str, int]] = []

    def get_frame_head(self, key: str, limit: int) -> tuple[pd.DataFrame, int]:
        self.reads.append((key, limit))
        return self._frame.head(limit).reset_index(drop=True), int(len(self._frame))

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
    assert store.reads == [("ds-1/v1.parquet", 5_000)]


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
    assert store.reads == [("ds-1/v1.parquet", 5_000)]
