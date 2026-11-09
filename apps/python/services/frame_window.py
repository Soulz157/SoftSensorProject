"""Time-window filtering shared by the artifact rows / histogram / boxplot /
correlation reads.

`start_time`/`end_time` keep rows INSIDE one window, as before. The
`exclude_start`/`exclude_end` pair additionally DROPS one inner window — the
validation holdout, which can sit in the middle of a dataset's span with
training rows on both sides. A raw (BRONZE) artifact still holds those
holdout rows (it is the fetch, before the holdout was cut), so comparing raw
data against the validation set needs "everything except [from, to]", which a
single start/end window cannot express (2026-10-18).

Both bounds are inclusive, the same convention as `start_time`/`end_time`.
Timestamps are the frame's own naive wall-clock strings.
"""

from __future__ import annotations

import pandas as pd

from intergrations.object_store import TIMESTAMP_COLUMN


def filter_time_window(
    frame: pd.DataFrame,
    *,
    start_time: str | None = None,
    end_time: str | None = None,
    exclude_start: str | None = None,
    exclude_end: str | None = None,
) -> pd.DataFrame:
    """Rows inside [start_time, end_time] and outside [exclude_start,
    exclude_end]. Any bound left as None does not filter."""
    ts = frame[TIMESTAMP_COLUMN]
    mask = pd.Series(True, index=frame.index)
    if start_time is not None:
        mask &= ts >= pd.Timestamp(start_time)
    if end_time is not None:
        mask &= ts <= pd.Timestamp(end_time)
    if exclude_start is not None and exclude_end is not None:
        mask &= ~((ts >= pd.Timestamp(exclude_start)) & (ts <= pd.Timestamp(exclude_end)))
    return frame[mask]


def is_window_filtered(
    start_time: str | None,
    end_time: str | None,
    exclude_start: str | None,
    exclude_end: str | None,
) -> bool:
    """Whether any bound narrows the frame (the rows read reports this)."""
    return any(v is not None for v in (start_time, end_time, exclude_start, exclude_end))
