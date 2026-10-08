"""MODEL-FLOW-009-T01/T02/T03. Sequence-model (lstm/gru) windowing.

Pure pandas/numpy — no torch/tensorflow — deliberately kept usable and fully
unit-testable without either dependency.

No forecast/lookback-window concept exists anywhere else in this codebase to
anchor a target convention, so this is a NOWCAST, not a forecast: window i
covers rows [i-sequence_length+1, i] and predicts the target AT row i (the
window's own last timestep) — the same convention every other algorithm here
already uses (features and target share a timestamp). This keeps
predictions.parquet's {timestamp, y_true, y_pred} schema unchanged for a
sequence algorithm; a next-step-ahead convention would have required changing
that contract for no requested benefit.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from config import TIMESTAMP_COLUMN

DEFAULT_SEQUENCE_LENGTH = 24


def build_windows(
    frame: pd.DataFrame,
    target_y: str,
    feature_cols: list[str],
    sequence_length: int,
    label_mask: pd.Series,
) -> tuple[np.ndarray, np.ndarray, pd.Series]:
    """(samples, timesteps, features) windows, built over the FULL time-ordered
    frame — NOT the post-`labelled_mask` frame the tabular split receives.

    Why the full frame: consecutive rows in a `labelled`-only frame are NOT
    consecutive in wall-clock time (a lab target sampled daily against a 1-minute
    grid is ~1,440 rows per label). Windowing over `labelled` at
    sequence_length=24 would silently span 24 DAYS of history, not 24 grid-steps,
    and `assert_no_target_leakage` would not catch it (it returns early when
    `derived` is empty — a dataset with no target-derived FEATURE column can have
    that same ~1,440 rows-per-label ratio and never trip it). Windowing over the
    full frame preserves the frame's true spacing; only a window's INCLUSION is
    gated by `label_mask`, checked on its target row (row i, the window's last
    row) — an unlabelled target row produces no window at all, not a padded or
    partial one, and neither does a target row without `sequence_length` rows of
    history behind it (no padding — dropped, same as an unlabelled one).

    `frame` MUST already be sorted by TIMESTAMP_COLUMN ascending with a reset
    index — this does not re-sort itself, so it fails loudly on a caller that
    forgot to rather than silently accepting a different order than
    `label_mask`'s own index assumes.

    Returns (X, y, target_timestamps): X is
    (n_windows, sequence_length, len(feature_cols)); y and target_timestamps are
    length n_windows, walking in the same ascending order as X's first axis.
    """
    if sequence_length < 1:
        raise RuntimeError(
            f"sequence_length must be >= 1, got {sequence_length}.")
    if not frame[TIMESTAMP_COLUMN].is_monotonic_increasing:
        raise RuntimeError(
            "build_windows requires frame sorted by TIMESTAMP_COLUMN ascending."
        )

    feature_matrix = frame[feature_cols].to_numpy(dtype=float)
    target_values = frame[target_y].to_numpy(dtype=float)
    timestamps = frame[TIMESTAMP_COLUMN]
    mask = label_mask.to_numpy()

    windows: list[np.ndarray] = []
    targets: list[float] = []
    target_ts: list[Any] = []
    for i in range(sequence_length - 1, len(frame)):
        if not mask[i]:
            continue
        windows.append(feature_matrix[i - sequence_length + 1: i + 1])
        targets.append(target_values[i])
        target_ts.append(timestamps.iloc[i])

    if not windows:
        return (
            np.empty((0, sequence_length, len(feature_cols))),
            np.empty((0,)),
            pd.Series(dtype="datetime64[ns]"),
        )

    return (
        np.stack(windows),
        np.array(targets),
        pd.Series(target_ts).reset_index(drop=True),
    )
