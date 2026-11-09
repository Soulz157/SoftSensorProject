from datetime import datetime, timedelta

import pytest

from services.data_service import DataService


def _service() -> DataService:
    # `_time_windows` is pure; it never touches the PI client.
    return DataService(webapi=None)  # type: ignore[arg-type]


START = datetime(2022, 1, 1, 0, 0)
END = datetime(2023, 1, 1, 0, 0)


def test_small_range_is_one_window():
    windows = _service()._time_windows(
        START, START + timedelta(days=1), timedelta(hours=1), 5
    )
    assert windows == [(START, START + timedelta(days=1))]


@pytest.mark.parametrize(
    "interval,tags",
    [(timedelta(hours=1), 20), (timedelta(minutes=1), 9)],
)
def test_split_windows_are_contiguous_and_cover_the_range(interval, tags):
    windows = _service()._time_windows(START, END, interval, tags)
    assert len(windows) > 1
    assert windows[0][0] == START
    assert windows[-1][1] == END
    # Summary buckets are end-exclusive: the next window must start exactly
    # where the previous one ended, or the bucket at the seam is never asked for.
    for (_, prev_end), (next_start, _) in zip(windows, windows[1:]):
        assert next_start == prev_end


def test_end_not_after_start_is_refused():
    with pytest.raises(ValueError):
        _service()._time_windows(START, START, timedelta(hours=1), 1)
