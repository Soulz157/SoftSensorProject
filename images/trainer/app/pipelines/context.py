"""The two types that define the strategy seam.

`PreparedRun` is everything the shared preamble established and every strategy
may read. `TrainingResult` is everything a strategy must produce and the shared
postamble consumes. Nothing else crosses.

The point of pinning these down: the differences between the three training
strategies used to be spread across six separate `if is_cv:` / `if is_sequence:`
branches in one 300-line function — metrics naming, splitSpec shape, whether
predictions.parquet exists, whether cv_folds.json exists, whether a loss
trajectory exists, whether the holdout is scored inline. Every one of those is
now a FIELD, so adding a fourth strategy cannot mean forgetting one of the six.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd

from config import TIMESTAMP_COLUMN

LogFn = Callable[..., None]


@dataclass
class PreparedRun:
    """Read-only, for a strategy. Produced once by the shared preamble."""

    spec: dict[str, Any]
    frame: pd.DataFrame
    feature_spec: dict[str, Any]
    target_y: str
    feature_cols: list[str]
    label_mask: pd.Series
    derived: list[str]
    artifact_checksum: str

    @property
    def algorithm(self) -> str:
        return self.spec["algorithm"]

    @property
    def hyperparameters(self) -> dict[str, Any]:
        return self.spec.get("hyperparameters") or {}

    @property
    def seed(self) -> int:
        return self.spec["seed"]


@dataclass
class TrainingResult:
    """What the shared postamble needs, and nothing more.

    `model` is the object that becomes model.joblib. For CV that is the REFIT
    (fit k+1) over the full labelled frame, never fold k's model — see
    cv_expanding.py.
    """

    model: Any
    metrics: dict[str, Any]
    split_spec: dict[str, Any]
    # None means NO FILE IS WRITTEN and no placeholder is invented. Under CV
    # there is no single held-out series, and that is the point
    # (MODEL-FLOW-016 userDecisions).
    predictions: pd.DataFrame | None
    # None for a closed-form algorithm, an over-cap trajectory, or CV (k+1
    # independent fits have no single trajectory to show). The CLIENT decides
    # render mode from whether a run has a lossHistoryKey, never from a switch
    # on the algorithm name.
    loss_history: dict[str, Any] | None = None
    # filename -> JSON payload. cv_folds.json is the only inhabitant today.
    extra_json: dict[str, Any] = field(default_factory=dict)
    # MODEL-FLOW-016-T07. False for CV: holdout scoring there is a SEPARATE,
    # USER-TRIGGERED phase against the refit model, run as its own container
    # spawn well after this run's /complete (see pipelines/score.py). `claim()`
    # itself never sends `holdoutDataUrl` for a CV run
    # (model-run.authorized.service.ts's own `isCvRun` gate); this flag is the
    # second, cheap backstop — if that gate ever regressed, scoring inline
    # would silently double the replay/prepare work score.py deliberately pays
    # only once.
    holdout_eligible: bool = True
    # Not None only for lstm/gru, where holdout scoring must window the same
    # way training did.
    holdout_sequence_length: int | None = None


def labelled_frame(prepared: PreparedRun, log_fn: LogFn | None = None) -> pd.DataFrame:
    """The labelled, time-ordered, reset-index frame both TABULAR strategies
    work from.

    Sorted here, not in `chronological_split`, because `expanding_fold_plan`
    also requires it and relies on `.loc[test_start, TIMESTAMP_COLUMN]`
    resolving positionally against a reset index.

    Sequence strategies do NOT use this — see windows.build_windows for why
    windowing over a labelled-only frame is wrong.
    """
    labelled = (
        prepared.frame.loc[prepared.label_mask]
        .sort_values(TIMESTAMP_COLUMN)
        .reset_index(drop=True)
    )
    if log_fn:
        log_fn(
            f"{len(labelled)} labelled rows of {len(prepared.frame)} "
            f"({100 * len(labelled) / max(len(prepared.frame), 1):.2f}%)"
        )
    if len(labelled) < 30:
        raise RuntimeError(
            f"Only {len(labelled)} rows have a Good target — too few to split. "
            f"The artifact has {len(prepared.frame)} rows, so the target is far "
            "sparser than the grid; consider aggregating to the target's "
            "interval."
        )
    return labelled
