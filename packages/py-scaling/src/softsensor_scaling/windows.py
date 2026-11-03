"""MODEL-SERVE-043/045. Scoring-time sequence windowing, shared by the
trainer image (pipelines/infer.py, pipelines/batch.py) and apps/serving's
/predict, so every scoring path builds the SAME windows training did.

Moved verbatim from images/trainer/app/windows.py, which re-exports it; the
parity test against training's `build_windows` lives there
(test/test_sequence_inference.py). numpy/pandas only.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


_INTERVAL_UNITS = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}


def parse_interval(text: object) -> pd.Timedelta | None:
    """'1m' / '30s' / '1h' -> Timedelta; None for anything else (a non-PI
    source has no interval, and a wrong guess is worse than none)."""
    import re

    if not isinstance(text, str):
        return None
    match = re.fullmatch(r"\s*(\d+)\s*([smhd])\s*", text)
    if not match or int(match.group(1)) <= 0:
        return None
    return pd.Timedelta(**{_INTERVAL_UNITS[match.group(2)]: int(match.group(1))})


def build_inference_windows(
    feature_matrix: np.ndarray,
    sequence_length: int,
    scorable: np.ndarray,
    timestamps: pd.Series | None = None,
    interval: pd.Timedelta | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """MODEL-SERVE-043. The scoring-time twin of `build_windows`: no target,
    no label mask, and a row is only scored when its whole history is real.

    `feature_matrix` is (n, n_features), ALREADY SCALED, rows in time order.
    Window i is rows [i-sequence_length+1, i] and predicts row i — the same
    end-aligned nowcast convention `build_windows` uses, which is what the
    parity test pins (an off-by-one here shifts every prediction one step
    with nothing to catch it).

    Row i gets a window only when ALL of:
      * `scorable[i]` — lead-in (context) rows are history, never scored;
      * i >= sequence_length - 1 — no padding, same as training;
      * no NaN anywhere in the window;
      * when `timestamps` and `interval` are given, every consecutive pair
        inside the window is exactly `interval` apart. A Bad row dropped
        upstream, or a minute the historian never returned, leaves a gap, and
        a window across a gap is not the 24 consecutive steps the model was
        trained on (user decision 2026-11-01: do not predict that row).

    Returns (X, positions): X is (n_windows, sequence_length, n_features),
    `positions` the row index i of each window, ascending.
    """
    if sequence_length < 1:
        raise RuntimeError(
            f"sequence_length must be >= 1, got {sequence_length}.")
    n = feature_matrix.shape[0]
    n_features = feature_matrix.shape[1] if feature_matrix.ndim == 2 else 0
    empty = (
        np.empty((0, sequence_length, n_features)),
        np.empty((0,), dtype=int),
    )
    if n < sequence_length:
        return empty

    matrix = np.asarray(feature_matrix, dtype=float)
    # Prefix sums turn "any bad row / any gap inside [i-L+1, i]" into O(1)
    # per row instead of re-scanning L rows each time.
    nan_rows = np.isnan(matrix).any(axis=1).astype(int)
    nan_prefix = np.concatenate([[0], np.cumsum(nan_rows)])

    gap_prefix: np.ndarray | None = None
    if timestamps is not None and interval is not None:
        ts = pd.to_datetime(pd.Series(timestamps).reset_index(drop=True))
        if not ts.is_monotonic_increasing:
            raise RuntimeError(
                "build_inference_windows requires timestamps sorted ascending."
            )
        steps = ts.diff().to_numpy()
        # breaks[k] = 1 when row k does not follow row k-1 by exactly one step.
        breaks = np.zeros(n, dtype=int)
        breaks[1:] = (steps[1:] != np.timedelta64(interval)).astype(int)
        gap_prefix = np.concatenate([[0], np.cumsum(breaks)])

    windows: list[np.ndarray] = []
    positions: list[int] = []
    for i in range(sequence_length - 1, n):
        if not scorable[i]:
            continue
        start = i - sequence_length + 1
        if nan_prefix[i + 1] - nan_prefix[start] > 0:
            continue
        # Breaks are counted on rows start+1..i: the first row of a window
        # may follow anything.
        if gap_prefix is not None and gap_prefix[i + 1] - gap_prefix[start + 1] > 0:
            continue
        windows.append(matrix[start: i + 1])
        positions.append(i)

    if not windows:
        return empty
    return np.stack(windows), np.array(positions, dtype=int)
