"""Which rows carry a real target value, and how far apart they are.

MIRRORS apps/python — `labelled_mask` is duplicated, not imported, because this
trainer ships in a separate container image with no import path back to
apps/python. See MIRRORS.md for the full index of cross-boundary duplicates in
this codebase and what has to change together.
"""

from __future__ import annotations

from typing import Callable

import pandas as pd

from config import STATUS_GOOD, STATUS_SUFFIX

LogFn = Callable[..., None]


def status_column(tag: str) -> str:
    return f"{tag}{STATUS_SUFFIX}"


def labelled_mask(
    frame: pd.DataFrame, target_y: str, log_fn: LogFn | None = None
) -> pd.Series:
    """DS-LAKE-023-T03/D4. The SAME non-Good-target mask the train/test split
    applies, extracted so every holdout and scoring path applies it too. Before
    this fix, nothing dropped an unlabelled row from the holdout: for a lab
    target sampled far sparser than the PI grid, the holdout window is mostly
    unlabelled, `r2_score` raises on NaN, and the best-effort `except Exception`
    around holdout scoring swallowed it — meaning holdout metrics likely never
    rendered at all for exactly the dataset shape this feature (DS-LAKE-023)
    exists to improve.

    `log_fn` is optional so this stays callable from a context (or a test) with
    no API session of its own; every live call site passes the real one.
    """
    target_status = status_column(target_y)
    if target_status in frame.columns:
        mask = frame[target_status] == STATUS_GOOD
    else:
        if log_fn:
            log_fn(
                f"'{target_status}' absent — falling back to non-null target",
                "warn",
            )
        mask = frame[target_y].notna()
    return mask & frame[target_y].notna()


def median_gap_minutes(series: pd.Series) -> float | None:
    """Median spacing between consecutive entries, in minutes."""
    if len(series) < 3:
        return None
    deltas = series.sort_values().diff().dropna()
    if deltas.empty:
        return None
    return float(deltas.dt.total_seconds().median() / 60.0)
