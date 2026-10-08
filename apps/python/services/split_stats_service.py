"""MODEL-FLOW-014-T03. Server-side train/test split distribution for Step 3's
Training Configuration — both sides of the chronological split
`images/trainer/train.py` would actually make for a given `split_ratio`,
computed from ONE read of a committed FINAL artifact.

WHY A NEW ENDPOINT, NOT TWO `/boxplot` CALLS (MODEL-FLOW-014's own resolved
userDecisions): two calls would open the artifact twice for one comparison,
and would put the cut-point derivation in the CLIENT — which is where it is
least able to be right (see the cut-rule note below). The client sends
`split_ratio`; this service derives the cut internally and ECHOES
`cut_timestamp` back, the same reason `/correlation` echoes its resolved tag
list.

THE CUT IS ON LABELLED ROWS, NOT ON ROWS (MODEL-FLOW-014-T01, confirmed
against `images/trainer/train.py` directly, not inferred): `train.py` drops
every non-Good TARGET row BEFORE calling `chronological_split` — the real
boundary is `int(len(labelled) * ratio)`, not `int(len(frame) * ratio)`.
`labelled_mask` below is a deliberate mirror of `train.py::labelled_mask`
(the trainer ships in a separate container image and cannot be imported);
`test_split_stats_service.py` pins the two rules as identical.

SAMPLE_ROWS NEVER TOUCHES THE CUT. Every other chart service caps its
window at `sample_rows` (default 5,000) before computing anything — cutting
there would silently show the split of the first `sample_rows` labelled
rows, the exact "plausible but meaningless" failure `train.py`'s own module
docstring exists to warn about. The cut here is always derived from the
FULL labelled frame; `sample_rows` only bounds the per-tag box statistics
computed on each side afterward, via `services.downsample.systematic_sample`
(MODEL-FLOW-014-T02) — the same fix that made every sibling chart service's
sampling honest.

TABULAR ONLY. `lstm`/`gru` cut on WINDOW count via
`train.py::chronological_split_windows`, a different rule entirely (windows
over the full time-ordered frame, not the labelled one). This endpoint does
not attempt that split; the client states as much rather than showing a
number this service does not compute.

Raises `ValueError` for anything the caller can fix — unlike every sibling
chart service, that now includes the two refusals `train.py::
chronological_split` itself raises as `RuntimeError` (a ratio that leaves
one side empty; fewer than `MIN_LABELLED_ROWS` labelled rows), since
`routers.preprocess._run` has no `RuntimeError` branch and would otherwise
map either to an opaque 502 (MODEL-FLOW-014-T01 finding).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from intergrations.object_store import (
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    ObjectStore,
    status_column,
)
from schemas.preprocess import SplitStatsRequest
from services.boxplot_service import boxplot_stats, good_values, qualifies
from services.downsample import systematic_sample

#: Mirrors `train.py`'s own floor (`if len(labelled) < 30: raise
#: RuntimeError(...)`) — a run this sparse never trains, so a panel showing
#: it a split would be describing a run that cannot happen.
MIN_LABELLED_ROWS = 30

# MODEL-FLOW-016-T02. MEASURED, not picked — the same discipline
# GPR_MAX_TRAIN_ROWS and LSTM_MAX_TRAIN_WINDOWS (images/trainer/train.py)
# follow for their own constants: fit real models (Ridge, StandardScaler'd)
# across TimeSeriesSplit(n_splits=k) for k=2..10 against TWO real GOLD
# artifacts of different sparsity (target S204FBP.lab), and record where
# adjacent-fold RMSE stops varying wildly.
#
#   artifact          k   min_distinct_in_fold   rmse_cv   max_adjacent_jump
#   66173c35 (32 tot) 2   10                     0.605     0.75
#   66173c35 (32 tot) 3    8                     0.273     0.41   <- stable
#   66173c35 (32 tot) 4    6                     0.455     1.46   <- degraded
#   66173c35 (32 tot) 5    5                     0.464     1.21
#   66173c35 (32 tot) 7    4                     0.793     8.40
#   798bec37 (97 tot) 2   33                     0.210     0.35
#   798bec37 (97 tot) 3   26                     0.251     0.69   <- stable
#   798bec37 (97 tot) 4   20                     0.717     2.39   <- degraded,
#                                                                     NOT monotone
#
# rmse_cv is the coefficient of variation (std/mean) of per-fold test RMSE —
# a smoother signal than max_adjacent_jump, which one outlier fold can spike.
# On BOTH artifacts, cv stays under 0.3 through k=3 and roughly doubles by
# k=4. floor(distinct_total / MIN_LABELS_PER_FOLD) = 3 on the sparse
# artifact (32 distinct) requires MIN_LABELS_PER_FOLD in [9, 10]; 10 is
# chosen as the more conservative of the two, leaving floor(97/10) = 9 on
# the dense artifact — not obviously worse than several LOWER k values
# there (k=4's cv of 0.717 is the single worst point measured on that
# artifact, at k=4, not at the cap).
#
# THE CONFOUND, STATED RATHER THAN HIDDEN: varying k changes fold TEST size
# (shrinks) and fold TRAIN size (shrinks at fold 1) simultaneously with
# distinct-count, and this real data ALSO carries genuine regime-shift
# noise independent of both — 798bec37's k=4 has 20-24 distinct values per
# fold (well above this constant) yet its worst per-fold RMSE (1.318) is
# larger than several sparser, higher-k folds elsewhere in the same table.
# This constant targets LABEL THINNESS specifically; it does not and cannot
# eliminate the regime-shift component — MODEL-FLOW-016-T11's per-fold row
# count table exists precisely so a human can still catch that remaining
# case by eye.
#
# Measured 2026-09-01 against scikit-learn 1.5.2 (the trainer's own pin) in
# a throwaway venv — apps/python carries no scikit-learn dependency, and
# this arithmetic (see `_expanding_fold_plan` below) is simple enough not
# to need one as a runtime dependency for one cut rule. The hand-rolled cut
# arithmetic itself was checked index-for-index against a REAL
# `sklearn.model_selection.TimeSeriesSplit` for n in {8350, 15441, 1341,
# 100, 97, 33, 6} and k in 2..10: zero mismatches.
#
# THIS IS A TOTAL-DISTINCT DIVISOR, NOT A PER-FOLD FLOOR — read the table
# above before "fixing" this. max_admissible_k = distinct_total //
# MIN_LABELS_PER_FOLD, and a fold's own distinct count runs roughly
# distinct_total/(k+1), NOT distinct_total/k — so the admitted k's folds
# legitimately hold FEWER than MIN_LABELS_PER_FOLD each. On the sparse
# artifact above, k=3 (admitted: floor(32/10)=3) has folds holding 8, 10,
# 8 — below the constant's own name, by design, because 10 was calibrated
# to land the cap exactly at k=3, the measured stability point, absorbing
# this k-vs-(k+1) denominator gap rather than pretending it away. DO NOT
# add a `min(fold.distinct) >= MIN_LABELS_PER_FOLD` assertion anywhere —
# it would refuse a configuration this constant was deliberately measured
# to admit.
MIN_LABELS_PER_FOLD = 10


def _expanding_fold_plan(
    labelled: pd.DataFrame, target_y: str, k: int
) -> list[dict[str, Any]]:
    """`sklearn.model_selection.TimeSeriesSplit(n_splits=k)`'s own cut
    arithmetic, over the LABELLED, time-ordered frame — mirrored here rather
    than imported because `images/trainer/train.py` (the actual fitting
    authority) ships in a separate container image with no import path back
    to this service, the same constraint `labelled_mask` above already lives
    with. Verified index-for-index against a real `TimeSeriesSplit` (see
    `MIN_LABELS_PER_FOLD`'s own comment) — change both if either drifts.

    `labelled` must already be the labelled, TIMESTAMP_COLUMN-sorted frame
    `build_split_stats` produces — this does not re-sort or re-mask.

    Each fold is EXPANDING (train = everything before the fold's own test
    window), never rolling — see this feature's own resolved userDecisions.
    Test size is `len(labelled) // (k + 1)`, sklearn's own rule, constant
    across every fold; any REMAINDER row (`len(labelled) % (k + 1)`) lands
    in fold 0's TRAIN window, never in any fold's test window — confirmed
    against the same real `TimeSeriesSplit` run above, not assumed.
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


def labelled_mask(frame: pd.DataFrame, target_y: str) -> pd.Series:
    """Mirrors `images/trainer/train.py::labelled_mask` exactly — the
    trainer ships in a separate container image (`images/trainer/`) and
    cannot be imported here, so this is a deliberate, tracked duplicate.
    Change both; `test_split_stats_service.py` pins the two rules as
    identical against a shared fixture shape.
    """
    target_status = status_column(target_y)
    if target_status in frame.columns:
        mask = frame[target_status] == STATUS_GOOD
    else:
        mask = frame[target_y].notna()
    return mask & frame[target_y].notna()


def _side_payload(
    side: pd.DataFrame, tags: list[str], sample_rows: int, outlier_cap: int
) -> dict[str, Any]:
    """One side of the split, in `BoxplotResponse`-shaped form — reuses
    `boxplot_service`'s own Good-value filter, five-number summary and
    qualification gate (`good_values`/`boxplot_stats`/`qualifies`) rather
    than a sixth copy of the same predicate (DS-LAKE's own ledger records
    five pre-existing copies as a real drift risk).
    """
    sampled = systematic_sample(side, sample_rows).reset_index(drop=True)

    tags_out: list[dict[str, Any]] = []
    insufficient: list[str] = []
    for tag in tags:
        good = good_values(sampled, tag)
        stats = boxplot_stats(good)
        if not qualifies(stats):
            insufficient.append(tag)
            continue
        outliers_full = stats["outliers_full"]
        tags_out.append(
            {
                "tag": tag,
                "min": stats["min"],
                "q1": stats["q1"],
                "median": stats["median"],
                "mean": stats["mean"],
                "q3": stats["q3"],
                "max": stats["max"],
                "whisker_low": stats["whisker_low"],
                "whisker_high": stats["whisker_high"],
                "outliers": outliers_full[:outlier_cap],
                "outlier_count": len(outliers_full),
                "count": stats["count"],
            }
        )

    return {"tags": tags_out, "insufficient_tags": insufficient}


def build_split_stats(store: ObjectStore, request: SplitStatsRequest) -> dict[str, Any]:
    """One read of `data.parquet`; both sides computed from that one frame.

    Raises `ValueError` for anything the caller can fix (unknown column,
    a ratio that empties a side, too few labelled rows) — mapped by the
    router to 422, same convention as every sibling chart service. See this
    module's own docstring for why the two `train.py` `RuntimeError`s are
    raised as `ValueError` here instead.

    MODEL-FLOW-016-T02/T09. `request.split_ratio`/`request.n_splits` are
    mutually exclusive (enforced by the request schema's own validator) —
    exactly one drives the response shape below. `distinct_labelled_values`/
    `max_admissible_k` are ALWAYS computed and returned regardless of which
    mode is active: they are one more cheap aggregate over a frame already
    in memory (T02's own instruction), and the wizard needs them before the
    user ever flips into CV mode, to disable-with-reason at config time
    (MODEL-FLOW-016-T10) rather than after a request round trip.
    """
    columns = {TIMESTAMP_COLUMN, request.target_y, status_column(request.target_y)}
    for tag in request.tags:
        columns.add(tag)
        columns.add(status_column(tag))

    frame = store.get_frame(request.source_key, columns=sorted(columns))

    mask = labelled_mask(frame, request.target_y)
    labelled = frame.loc[mask].sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)

    if len(labelled) < MIN_LABELLED_ROWS:
        raise ValueError(
            f"Only {len(labelled)} rows have a Good {request.target_y!r} — too "
            f"few to split. The artifact has {len(frame)} rows, so the target "
            "is far sparser than the grid; consider aggregating to the "
            "target's interval."
        )

    # MODEL-FLOW-016-T02. Effective sample size is the DISTINCT labelled
    # value count, not the row count — a forward-filled sparse target can
    # have `len(labelled) == len(frame)` while carrying a handful of real
    # observations (T01's own live measurement). Always computed, per this
    # function's own docstring above.
    distinct_labelled_values = int(labelled[request.target_y].nunique())
    max_admissible_k = distinct_labelled_values // MIN_LABELS_PER_FOLD

    if request.n_splits is not None:
        # REFUSE, DO NOT DEGRADE (T02's own instruction) — a dataset
        # admitting fewer folds than requested is refused BY NAME at config
        # time, never silently run as an under-powered CV that would look
        # indistinguishable from a real estimate.
        if request.n_splits > max_admissible_k:
            raise ValueError(
                f"n_splits={request.n_splits} exceeds the admissible maximum "
                f"of {max_admissible_k} for {request.target_y!r}: "
                f"{distinct_labelled_values} distinct labelled values, "
                f"{MIN_LABELS_PER_FOLD} required per fold (see "
                "MIN_LABELS_PER_FOLD in split_stats_service.py for how that "
                "floor was measured). Lower n_splits, or this target cannot "
                "support cross-validation on this dataset."
            )
        folds = _expanding_fold_plan(labelled, request.target_y, request.n_splits)
        return {
            "source_key": request.source_key,
            "target_y": request.target_y,
            # Explicit None, not omitted — matches SplitStatsResponse's
            # shape exactly rather than relying on the FastAPI response_model
            # to backfill defaults, so a direct call to this function (as
            # every test here makes) sees the same shape a real HTTP
            # response would.
            "split_ratio": None,
            "cut_timestamp": None,
            "train_labelled_rows": None,
            "test_labelled_rows": None,
            "train": None,
            "test": None,
            "source_rows": int(len(frame)),
            "distinct_labelled_values": distinct_labelled_values,
            "max_admissible_k": max_admissible_k,
            "n_splits": request.n_splits,
            "folds": folds,
        }

    # Cut on the FULL labelled frame — never sample_rows. See this module's
    # own docstring; matches train.py::chronological_split exactly.
    cut = int(len(labelled) * request.split_ratio)
    if cut < 1 or cut >= len(labelled):
        raise ValueError(
            f"Split ratio {request.split_ratio} leaves one side empty at "
            f"{len(labelled)} labelled rows."
        )
    cut_timestamp = labelled.loc[cut, TIMESTAMP_COLUMN]

    train_side = labelled.iloc[:cut]
    test_side = labelled.iloc[cut:]

    return {
        "source_key": request.source_key,
        "target_y": request.target_y,
        "split_ratio": request.split_ratio,
        "cut_timestamp": str(cut_timestamp),
        "train_labelled_rows": int(len(train_side)),
        "test_labelled_rows": int(len(test_side)),
        "source_rows": int(len(frame)),
        "distinct_labelled_values": distinct_labelled_values,
        "max_admissible_k": max_admissible_k,
        # Explicit None, not omitted — symmetric with the n_splits branch
        # above.
        "n_splits": None,
        "folds": None,
        "train": _side_payload(
            train_side, request.tags, request.sample_rows, request.outlier_cap
        ),
        "test": _side_payload(
            test_side, request.tags, request.sample_rows, request.outlier_cap
        ),
    }
