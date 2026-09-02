"""Every rule by which this trainer cuts time.

Three of them, and they are not interchangeable: rows (chronological), windows
(chronological_windowed), and expanding folds (cv_expanding). They live together
so the one property they all share is visible in one place — NEVER random. The
frame carries lag/rolling features, so a shuffled split puts future-derived rows
in train and inflates every metric.

MIRRORS apps/python — `expanding_fold_plan` and `MIN_LABELS_PER_FOLD` are
duplicated, not imported, for the same container-boundary reason as
`labels.labelled_mask`. See MIRRORS.md.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from config import TIMESTAMP_COLUMN

# MODEL-FLOW-016-T02/T03. Mirrors MIN_LABELS_PER_FOLD in apps/python
# services/split_stats_service.py EXACTLY — same measurement, same constant,
# same "TOTAL-DISTINCT DIVISOR, not a per-fold floor" caveat (see that file's own
# comment for the full measured table; not repeated here to avoid the two copies
# drifting on the TABLE while agreeing on the NUMBER). This is the FIT-TIME
# BACKSTOP behind /split-stats' own config-time refusal — a real check, not a
# formality: it costs nothing extra (the labelled frame is already in memory)
# and fires before fold 0 ever fits, so a request that somehow bypasses the
# wizard's disable-with-reason state still cannot buy k fits it should have been
# refused. test_split_stats_service.py and this package's own tests each pin
# this number identically.
MIN_LABELS_PER_FOLD = 10


def chronological_split(
    frame: pd.DataFrame, ratio: float
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Time-ordered split, plus the cut timestamp it actually landed on.

    The cut timestamp is RETURNED, not just the ratio, because a ratio resolves
    to a different boundary against a different row count — which is exactly
    what happens once non-Good target rows are dropped upstream of this call.
    """
    ordered = frame.sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)
    cut = int(len(ordered) * ratio)
    if cut < 1 or cut >= len(ordered):
        raise RuntimeError(
            f"Split ratio {ratio} leaves one side empty at {len(ordered)} "
            "labelled rows."
        )
    cut_timestamp = str(ordered.loc[cut, TIMESTAMP_COLUMN])
    return ordered.iloc[:cut], ordered.iloc[cut:], cut_timestamp


def chronological_split_windows(
    window_timestamps: pd.Series, ratio: float
) -> tuple[np.ndarray, np.ndarray, str]:
    """`chronological_split`'s cut rule, for pre-built windows.

    `window_timestamps` must already be ascending — `build_windows` walks the
    frame in timestamp order and keeps only windows whose target row is
    labelled, so it is already in the order this needs; re-sorting here would
    silently accept a caller that mixed up window order instead of failing on
    it.

    Returns (train_idx, test_idx, cut_timestamp): integer positions into the
    windows array (and into `window_timestamps`/the paired y array), plus the cut
    timestamp itself for the run manifest — same shape as
    `chronological_split`'s own return, so callers can log/record it the same
    way.
    """
    n = len(window_timestamps)
    if n == 0:
        raise RuntimeError("No windows to split.")
    if not window_timestamps.is_monotonic_increasing:
        raise RuntimeError(
            "chronological_split_windows requires window_timestamps ascending."
        )
    cut = int(n * ratio)
    if cut < 1 or cut >= n:
        raise RuntimeError(
            f"Split ratio {ratio} leaves one side empty at {n} windows.")
    cut_timestamp = str(window_timestamps.iloc[cut])
    return np.arange(0, cut), np.arange(cut, n), cut_timestamp


def expanding_fold_plan(
    labelled: pd.DataFrame, target_y: str, k: int
) -> list[dict[str, Any]]:
    """`sklearn.model_selection.TimeSeriesSplit(n_splits=k)`'s own cut
    arithmetic — mirrors `_expanding_fold_plan` in apps/python's
    `services/split_stats_service.py` EXACTLY. Verified index-for-index against
    a real `TimeSeriesSplit` — see that function's own docstring for the
    artifacts/k values checked; change both if either drifts, and
    MODEL-FLOW-016-T03's own V01 pins the two against each other's actual OUTPUT
    (not just the algorithm) by asserting this function's result equals a real
    `/split-stats` call's own fold plan for the same artifact and k.

    `labelled` must already be the labelled, TIMESTAMP_COLUMN-sorted frame with
    a reset index — this does not re-sort or re-mask. EXPANDING window only,
    never rolling; remainder rows land in fold 0's train window, never in any
    fold's test window.
    """
    n = len(labelled)
    test_size = n // (k + 1)
    target = labelled[target_y]
    folds: list[dict[str, Any]] = []
    for i in range(k):
        test_start = n - (k - i) * test_size
        test_end = n - (k - i - 1) * test_size
        cut_timestamp = labelled.loc[test_start, TIMESTAMP_COLUMN]
        distinct = int(target.iloc[test_start:test_end].nunique())
        folds.append(
            {
                "cut_timestamp": str(cut_timestamp),
                "train_rows": int(test_start),
                "test_rows": int(test_end - test_start),
                "distinct": distinct,
            }
        )
    return folds


def assert_admissible_fold_count(
    labelled: pd.DataFrame, target_y: str, n_splits: int
) -> int:
    """MODEL-FLOW-016-T02/T03. REFUSE, DO NOT DEGRADE.

    Effective sample size is the DISTINCT labelled value count, not the row
    count — the same reasoning split_stats_service.py's own `build_split_stats`
    applies. Returns the distinct-value count so the caller can record it in
    splitSpec without computing it twice.
    """
    distinct_labelled_values = int(labelled[target_y].nunique())
    max_admissible_k = distinct_labelled_values // MIN_LABELS_PER_FOLD
    if n_splits > max_admissible_k:
        raise RuntimeError(
            f"n_splits={n_splits} exceeds the admissible maximum of "
            f"{max_admissible_k} for {len(labelled)} labelled rows "
            f"({distinct_labelled_values} distinct values, "
            f"{MIN_LABELS_PER_FOLD} required per fold) — refused at fit "
            "time as a backstop; this should already have been refused "
            "at config time."
        )
    return distinct_labelled_values
