"""Assertions against failures that look like success.

These three are grouped because they share one property that makes them
different from the validation scattered through the pipeline: each catches a
condition under which the run COMPLETES and reports plausible numbers. That is
why they raise rather than warn, and why they belong together where a reader
looking for "what can silently ruin a run here" finds all of them at once.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from config import TIMESTAMP_COLUMN
from labels import median_gap_minutes

LogFn = Callable[..., None]


def assert_no_target_leakage(
    frame: pd.DataFrame,
    target_y: str,
    derived: list[str],
    label_mask: pd.Series,
    log_fn: LogFn | None = None,
) -> None:
    """Refuse a run whose target-derived features cannot carry real history.

    The failure this catches looks like success, which is why it is fatal rather
    than a warning. If the target is a lab value arriving daily but the frame is
    on a 1-minute grid, a forward-filled `Y_lag1` holds the SAME value as the
    current target — the model reads the answer off its own input and reports R²
    near 1.0.

    The comparison is between the target's own labelled spacing and the frame's
    row spacing: derived features are computed in ROWS, so a lag of n rows only
    reaches genuinely earlier information when n rows span more than one target
    sampling interval.
    """
    if not derived:
        return

    label_gap = median_gap_minutes(frame.loc[label_mask, TIMESTAMP_COLUMN])
    row_gap = median_gap_minutes(frame[TIMESTAMP_COLUMN])
    if label_gap is None or row_gap is None or row_gap <= 0:
        if log_fn:
            log_fn(
                "Could not establish sampling intervals — skipping leakage check",
                "warn",
            )
        return

    rows_per_label = label_gap / row_gap
    if rows_per_label > 1.5:
        raise RuntimeError(
            f"Target-derived features {derived} cannot carry real history: the "
            f"target is labelled every ~{label_gap:.0f} min but rows are "
            f"~{row_gap:.0f} min apart (~{rows_per_label:.0f} rows per label). "
            "A row-wise lag inside one labelling interval repeats the current "
            "target value, so the model would be reading its own answer. "
            "Either resample the frame to the target's interval or set the lag "
            "to at least that many rows."
        )
    if log_fn:
        log_fn(
            f"Leakage check passed: ~{rows_per_label:.1f} rows per labelled target")


def assert_no_window_leakage(
    window_timestamps: pd.Series, train_idx: np.ndarray, cut_timestamp: str
) -> None:
    """One assertion, not a new analysis: no train-assigned window's TARGET
    timestamp is at or after the split cut.

    Windows are keyed by their target row (`windows.build_windows`), so a
    correctly-assigned train window's span [i-sequence_length+1, i] is always
    entirely before the cut BY CONSTRUCTION — a test window legitimately looking
    backward past the cut for history is normal forecaster lookback, not
    leakage, and this does not flag it. The real failure mode this guards
    against is an implementation mistake: assigning a window to train/test by
    its START index instead of its TARGET index, which can smuggle a post-cut
    label into training. That is the one thing checked here.
    """
    cut_ts = pd.Timestamp(cut_timestamp)
    train_targets = window_timestamps.iloc[train_idx]
    leaked = train_targets[train_targets >= cut_ts]
    if not leaked.empty:
        raise RuntimeError(
            f"{len(leaked)} train-assigned window(s) have a target "
            f"timestamp at or after the split cut ({cut_timestamp}) — "
            "windows were assigned by start index instead of target "
            "index. Every train window's target timestamp must be "
            "before the cut."
        )


def assert_no_nan_features(X: np.ndarray, context: str) -> None:
    """MODEL-FLOW-009-T04. A window's INCLUSION is gated on its target row's
    label (`build_windows`), never on the quality of the non-target rows inside
    its span — a window legitimately reaches back through unlabelled rows for
    feature history. But if a FEATURE is NaN on one of those in-window rows,
    torch trains on it silently: no exception, just NaN loss from that step
    forward, which is the exact "looks like success" failure class this whole
    module is built around. Checked once, right after build_windows, rather than
    left to surface as an opaque NaN loss log line partway through fit().
    """
    if X.size == 0:
        return
    bad = np.isnan(X).any(axis=(1, 2))
    if bad.any():
        raise RuntimeError(
            f"{int(bad.sum())} {context} window(s) contain a NaN feature "
            "value on a non-target row within their span. A window's "
            "target row must be labelled Good, but its FEATURE rows are "
            "not filtered — resample or impute upstream so no feature is "
            "NaN across the full frame, not just on labelled rows."
        )
