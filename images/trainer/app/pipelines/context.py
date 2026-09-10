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

import math
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
    # MODEL-FLOW-019-T32. Population std per feature over EXACTLY the rows THIS
    # strategy fit `model` on — the train split for chronological, the full
    # labelled frame for CV's refit. A field rather than a computation at the
    # publish site (which is where importance is otherwise assembled) because
    # only the strategy knows which rows those were: `PreparedRun` carries the
    # whole frame and the label mask, never the split. None where no
    # coefficient exists to standardise (windowed/sequence), and importance
    # then takes its own honest-absence path rather than ranking on a
    # fabricated width.
    train_feature_std: dict[str, float] | None = None


def resolve_feature_columns(
    derived: list[str], requested: Any
) -> tuple[list[str], list[str]]:
    """MODEL-FLOW-019-T31. `(columns_to_use, missing)` for an optional subset.

    `derived` is what the artifact itself offers, already stripped of the
    timestamp, the target and the status columns. `requested` is the run spec's
    optional `featureColumns`.

    REFUSED, NOT INTERSECTED — the caller raises when `missing` is non-empty.
    A named column the frame does not have must fail the run rather than
    quietly training on the remainder: the whole point of a feature-count
    sweep row is that its `n` IS the number it claims, and a silent narrowing
    would put a row labelled n=7 on a curve while it was fit on five. That is
    the same class of failure MODEL-FLOW-013-T05 hit by checking an
    attribute's presence rather than its length.

    The order returned is the CALLER'S, so the ranking prefix a sweep sends is
    the order the run manifest records back.
    """
    if not requested:
        return (list(derived), [])
    available = set(derived)
    missing = [str(c) for c in requested if c not in available]
    return ([str(c) for c in requested], missing)


def feature_std(frame: pd.DataFrame, feature_cols: list[str]) -> dict[str, float]:
    """MODEL-FLOW-019-T32. Population std per feature over the rows given.

    `ddof=0`, matching `_welford_population_std` in packages/py-scaling — the
    convention the `standard` scaler itself fits with — rather than pandas'
    `ddof=1` default. The two differ by sqrt(n/(n-1)), which is invisible in a
    ranking but would make a standardized coefficient disagree with the figure
    a refit on scaled inputs reports, and the whole claim of that method is
    that the two are the same quantity.

    A column whose std is not finite is OMITTED rather than defaulted to zero
    or one: `extract_feature_importance` requires a width for EVERY feature
    before it will standardise, so an omission there becomes a stated absence
    instead of a rank built on an invented number.

    `skipna=False` for the same reason. pandas' default would compute a width
    over the NON-missing subset of a column and return a perfectly finite
    number for it, which is a width for rows the estimator was not fit on
    wearing the name of one for rows it was. In practice a tabular fit would
    already have raised on a NaN feature before reaching here, so this is the
    backstop rather than the load-bearing check — but it is the difference
    between "cannot measure" and a quiet wrong answer.
    """
    out: dict[str, float] = {}
    for col in feature_cols:
        if col not in frame.columns:
            continue
        try:
            value = float(frame[col].std(ddof=0, skipna=False))
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            out[col] = value
    return out


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
