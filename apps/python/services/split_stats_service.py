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
        "train": _side_payload(
            train_side, request.tags, request.sample_rows, request.outlier_cap
        ),
        "test": _side_payload(
            test_side, request.tags, request.sample_rows, request.outlier_cap
        ),
    }
