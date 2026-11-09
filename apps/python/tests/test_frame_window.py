"""2026-10-18. The exclude window (validation holdout cut from a raw read)."""

from __future__ import annotations

import pandas as pd
import pytest
from pydantic import ValidationError

from intergrations.object_store import STATUS_GOOD, status_column
from schemas.preprocess import (
    BoxplotRequest,
    CorrelationRequest,
    HistogramRequest,
    RowsRequest,
)
from services.artifact_service import rows
from services.boxplot_service import build_boxplot
from services.frame_window import filter_time_window, is_window_filtered
from services.histogram_service import build_histogram


class _ReadOnlyStore:
    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        return self._frame[columns].copy() if columns else self._frame.copy()


def _frame() -> pd.DataFrame:
    # 10 hourly rows; the "holdout" is hours 4..6, in the MIDDLE of the span.
    ts = pd.date_range("2025-11-06 00:00:00", periods=10, freq="h")
    values = [1.0, 1.0, 1.0, 1.0, 100.0, 100.0, 100.0, 1.0, 1.0, 1.0]
    return pd.DataFrame(
        {"timestamp": ts, "x": values, status_column("x"): [STATUS_GOOD] * 10}
    )


EXCLUDE = {"exclude_start": "2025-11-06 04:00:00", "exclude_end": "2025-11-06 06:00:00"}


def test_drops_an_inner_window_and_keeps_both_sides():
    out = filter_time_window(_frame(), **EXCLUDE)
    hours = out["timestamp"].dt.hour.tolist()
    assert hours == [0, 1, 2, 3, 7, 8, 9]  # before AND after the holdout


def test_combines_with_an_outer_window():
    out = filter_time_window(
        _frame(), start_time="2025-11-06 02:00:00", end_time="2025-11-06 08:00:00", **EXCLUDE
    )
    assert out["timestamp"].dt.hour.tolist() == [2, 3, 7, 8]


def test_no_bounds_is_a_no_op():
    assert len(filter_time_window(_frame())) == 10
    assert not is_window_filtered(None, None, None, None)
    assert is_window_filtered(None, None, "a", "b")


@pytest.mark.parametrize("model", [RowsRequest, HistogramRequest, BoxplotRequest, CorrelationRequest])
def test_every_read_requires_the_pair_together(model):
    base = {"source_key": "k", "tags": ["x"]}
    with pytest.raises(ValidationError, match="together"):
        model(**base, exclude_start="2025-11-06 04:00:00")


def test_an_inverted_exclude_window_is_refused():
    with pytest.raises(ValidationError, match="after"):
        HistogramRequest(
            source_key="k",
            tags=["x"],
            exclude_start="2025-11-06 06:00:00",
            exclude_end="2025-11-06 04:00:00",
        )


def test_histogram_never_counts_the_excluded_rows():
    store = _ReadOnlyStore(_frame())
    full = build_histogram(store, HistogramRequest(source_key="k", tags=["x"]))
    cut = build_histogram(store, HistogramRequest(source_key="k", tags=["x"], **EXCLUDE))
    full_x = next(h for h in full["tags"] if h["tag"] == "x")
    cut_x = next(h for h in cut["tags"] if h["tag"] == "x")
    assert (full_x["count"], full_x["max"]) == (10, 100.0)
    # the 100s lived only inside the holdout
    assert (cut_x["count"], cut_x["max"]) == (7, 1.0)


def test_boxplot_and_rows_honour_the_exclude_window():
    store = _ReadOnlyStore(_frame())
    box = build_boxplot(store, BoxplotRequest(source_key="k", tags=["x"], **EXCLUDE))
    bx = next(b for b in box["tags"] if b["tag"] == "x")
    assert (bx["count"], bx["max"]) == (7, 1.0)
    page = rows(store, RowsRequest(source_key="k", tags=["x"], **EXCLUDE))
    assert page["filtered"] is True
    assert page["total_row_count"] == 7
