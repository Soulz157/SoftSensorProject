"""MODEL-FLOW-038. Real `GridSearchCV` over the full cartesian `paramGrid`.

ONE trainer run does the whole search. The search only PICKS a combination: the
winner is then run through the normal strategy (`cv_expanding` / `chronological`)
so `metrics.json`, `cv_folds.json`, OOF, holdout, importance and `model.joblib`
are produced exactly as for any other run. `refit=False` for that reason — the
strategy owns the final fit.

`build_model` stays the ONLY place a UI hyperparameter dict becomes an
estimator (mlp tuple, `None` -> -1, `goss`, the GRP row ceiling, the seed).
`BuildModelEstimator` is a thin sklearn shell around it, so the search can never
disagree with the real fit about what a value means.

Folds are the SAME folds the follow-up strategy reports: CV runs reuse
`expanding_fold_plan`; a Train/Test run scores on one chronological fold cut at
the same place `chronological.run` cuts.

Folds x combinations are fitted in parallel for the forest algorithms only
(`PARALLEL_ALGORITHMS`), within the container's CPU budget (`cpu_budget`). The
result does not depend on the worker count: every fit is independent and
seeded, and the ranking is read back in grid order.

Sequence algorithms (lstm/gru) are refused: `SequenceRegressor` is not
sklearn-clonable, and CV is refused for them anyway. Their curated per-variant
path is unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from joblib import parallel_config
from sklearn.base import BaseEstimator, RegressorMixin
from sklearn.model_selection import GridSearchCV, ParameterGrid

from api import RunApi
from config import SCRATCH, cpu_budget
from models import SEQUENCE_ALGORITHMS, build_model
from pipelines.context import PreparedRun, labelled_frame
from splits import (
    assert_admissible_fold_count,
    chronological_split,
    chronological_split_holding_new,
    expanding_fold_plan,
)

# spec.rankingMetric -> sklearn scorer. `rmse` is the default: it is the metric
# the job's own `bestRunId` ranking uses unless the user picked MAE.
SCORING = {
    "rmse": "neg_root_mean_squared_error",
    "mae": "neg_mean_absolute_error",
}
DEFAULT_RANKING_METRIC = "rmse"

# Algorithms whose single fit is heavy AND single-threaded, so fitting several
# combinations at once uses CPUs that would otherwise sit idle. MEASURED for
# extra_trees on 30k rows under a 2-CPU cap (83s serial -> 46s on 2 workers,
# identical ranking); random_forest is the same sklearn forest code path.
# Deliberately NOT everything: lightgbm/xgboost already use several threads
# per fit and measured SLOWER in parallel (1.7s -> 2.7s, 8 small fits — worker
# start-up dominates), and ridge/ols/pls fit in milliseconds. Unmeasured
# (svm, grp, mlp) stay serial until someone measures them.
PARALLEL_ALGORITHMS = frozenset({"random_forest", "extra_trees"})


def search_parallelism(algorithm: str, n_tasks: int, budget: int) -> tuple[int, int]:
    """`(workers, threads_per_worker)` for a search of `n_tasks` fits.

    Workers never exceed the CPU budget or the number of fits, and the threads
    each worker may use are what is left of the budget, so workers x threads
    stays inside the quota instead of oversubscribing it.
    """
    if algorithm not in PARALLEL_ALGORITHMS or n_tasks < 2 or budget < 2:
        return 1, max(1, budget)
    workers = min(budget, n_tasks)
    return workers, max(1, budget // workers)


class BuildModelEstimator(RegressorMixin, BaseEstimator):
    """sklearn shell over `build_model`. `hyperparameters` is the searched
    parameter: a whole UI dict per grid point."""

    def __init__(
        self,
        algorithm: str,
        hyperparameters: dict[str, Any],
        seed: int,
        feature_spec: dict[str, Any],
    ) -> None:
        self.algorithm = algorithm
        self.hyperparameters = hyperparameters
        self.seed = seed
        self.feature_spec = feature_spec

    def fit(self, X: Any, y: Any) -> "BuildModelEstimator":
        self.model_ = build_model(
            self.algorithm,
            self.hyperparameters,
            self.seed,
            len(X),
            self.feature_spec,
        )
        self.model_.fit(X, y)
        return self

    def predict(self, X: Any) -> Any:
        return self.model_.predict(X)


@dataclass
class GridSearchOutcome:
    best_hyperparameters: dict[str, Any]
    payload: dict[str, Any]


def _fold_indices(
    prepared: PreparedRun, labelled: pd.DataFrame
) -> tuple[list[tuple[np.ndarray, np.ndarray]], bool]:
    """`(train_idx, test_idx)` positions into `labelled`, and whether CV."""
    split = prepared.spec["splitSpec"]
    if split.get("method") == "cv_expanding":
        n_splits = int(split["n_splits"])
        assert_admissible_fold_count(labelled, prepared.target_y, n_splits)
        folds = []
        for plan in expanding_fold_plan(labelled, prepared.target_y, n_splits):
            train_end = plan["train_rows"]
            test_end = train_end + plan["test_rows"]
            folds.append((np.arange(0, train_end), np.arange(train_end, test_end)))
        return folds, True

    ratio = float(split.get("ratio", 0.8))
    new_data_from = prepared.spec.get("augmentNewDataFrom")
    if new_data_from:
        train, test, _ = chronological_split_holding_new(
            labelled, ratio, pd.Timestamp(new_data_from)
        )
    else:
        train, test, _ = chronological_split(labelled, ratio)
    # `labelled` is already time-sorted with a reset index, so a split frame's
    # index labels ARE positions into it.
    return [(train.index.to_numpy(), test.index.to_numpy())], False


def _json_scalar(value: Any) -> Any:
    return value.item() if isinstance(value, np.generic) else value


def run_grid_search(prepared: PreparedRun, api: RunApi) -> GridSearchOutcome:
    ui_grid: dict[str, list[Any]] = prepared.spec["paramGrid"]
    if prepared.algorithm in SEQUENCE_ALGORITHMS:
        raise RuntimeError(
            "Grid search is tabular-only: lstm/gru are not sklearn-clonable. "
            "They keep the curated per-variant search."
        )
    if not ui_grid or any(len(values) == 0 for values in ui_grid.values()):
        raise RuntimeError("paramGrid needs at least one value for every key.")

    ranking = str(prepared.spec.get("rankingMetric") or DEFAULT_RANKING_METRIC)
    if ranking not in SCORING:
        raise RuntimeError(f"Unknown rankingMetric '{ranking}'.")

    labelled = labelled_frame(prepared, log_fn=api.log)
    folds, is_cv = _fold_indices(prepared, labelled)

    base = prepared.hyperparameters
    combos = [{**base, **combo} for combo in ParameterGrid(ui_grid)]
    api.log(
        f"Grid search: {len(combos)} combinations x {len(folds)} fold(s), "
        f"ranked by {ranking}"
    )

    workers, threads = search_parallelism(
        prepared.algorithm, len(combos) * len(folds), cpu_budget()
    )
    if workers > 1:
        api.log(f"Grid search: {workers} parallel workers, {threads} thread(s) each")

    search = GridSearchCV(
        BuildModelEstimator(
            prepared.algorithm, base, prepared.seed, prepared.feature_spec
        ),
        {"hyperparameters": combos},
        scoring=SCORING[ranking],
        cv=folds,
        refit=False,
        n_jobs=workers,
        error_score="raise",
    )
    X = labelled[prepared.feature_cols]
    y = labelled[prepared.target_y]
    if workers > 1:
        # The worker pool memory-maps X: into /scratch (tmpfs), because the
        # container's /dev/shm is Docker's 64 MB default. `inner_max_num_threads`
        # replaces loky's default of cpu_count // workers, which counts the
        # HOST's cores and would oversubscribe the quota.
        temp = SCRATCH / "joblib"
        temp.mkdir(parents=True, exist_ok=True)
        with parallel_config(
            backend="loky",
            inner_max_num_threads=threads,
            temp_folder=str(temp),
        ):
            search.fit(X, y)
    else:
        search.fit(X, y)

    results = search.cv_results_
    rows = []
    for i, combo in enumerate(combos):
        rows.append(
            {
                "rank": int(results["rank_test_score"][i]),
                "params": {k: _json_scalar(combo[k]) for k in ui_grid},
                "hyperparameters": {k: _json_scalar(v) for k, v in combo.items()},
                # sklearn scores are negated errors; flip back to the metric.
                "mean_score": float(-results["mean_test_score"][i]),
                "std_score": float(results["std_test_score"][i]),
                "mean_fit_time": float(results["mean_fit_time"][i]),
            }
        )
    rows.sort(key=lambda r: r["rank"])
    best = rows[0]
    api.log(f"Grid search best: {best['params']} {ranking}={best['mean_score']:.4f}")

    return GridSearchOutcome(
        best_hyperparameters=best["hyperparameters"],
        payload={
            "algorithm": prepared.algorithm,
            "ranking_metric": ranking,
            "cv": is_cv,
            "n_folds": len(folds),
            "n_combinations": len(combos),
            "grid": {
                k: [_json_scalar(v) for v in values] for k, values in ui_grid.items()
            },
            "best": best,
            "combinations": rows,
        },
    )


__all__ = [
    "BuildModelEstimator",
    "GridSearchOutcome",
    "PARALLEL_ALGORITHMS",
    "run_grid_search",
    "search_parallelism",
]
