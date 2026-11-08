"""MODEL-FLOW-038. GridSearchCV picks a combination; the strategy then runs it."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import numpy as np
import pandas as pd
import pytest
from sklearn.base import clone

from config import TIMESTAMP_COLUMN
from pipelines import cv_expanding
from pipelines.context import PreparedRun
from config import cpu_budget
from pipelines import grid_search
from pipelines.grid_search import (
    PARALLEL_ALGORITHMS,
    BuildModelEstimator,
    run_grid_search,
    search_parallelism,
)

TARGET = "y"


def _prepared(
    algorithm: str = "ridge",
    split: dict[str, Any] | None = None,
    param_grid: dict[str, list[Any]] | None = None,
    base: dict[str, Any] | None = None,
    rows: int = 200,
) -> PreparedRun:
    rng = np.random.default_rng(0)
    x1 = rng.normal(size=rows)
    x2 = rng.normal(size=rows)
    frame = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.date_range("2026-01-01", periods=rows, freq="h"),
            "x1": x1,
            "x2": x2,
            TARGET: 3 * x1 - 2 * x2 + rng.normal(scale=0.5, size=rows),
        }
    )
    spec: dict[str, Any] = {
        "algorithm": algorithm,
        "hyperparameters": base if base is not None else {"alpha": 1.0},
        "seed": 1,
        "splitSpec": split or {"method": "cv_expanding", "n_splits": 3},
        "paramGrid": param_grid or {"alpha": [0.01, 1.0, 100.0]},
    }
    return PreparedRun(
        spec=spec,
        frame=frame,
        feature_spec={},
        target_y=TARGET,
        feature_cols=["x1", "x2"],
        label_mask=pd.Series(True, index=frame.index),
        derived=[],
        artifact_checksum="x",
    )


def _api() -> SimpleNamespace:
    return SimpleNamespace(log=lambda *args, **kwargs: None)


def test_every_combination_is_ranked() -> None:
    outcome = run_grid_search(
        _prepared(param_grid={"alpha": [0.01, 1.0], "fit_intercept": [True, False]}),
        _api(),
    )
    combos = outcome.payload["combinations"]
    assert outcome.payload["n_combinations"] == 4 == len(combos)
    assert sorted(c["rank"] for c in combos) == [1, 2, 3, 4]
    assert outcome.payload["best"] == combos[0]
    assert outcome.best_hyperparameters["alpha"] == combos[0]["params"]["alpha"]


def test_best_score_equals_follow_up_cv_rmse_mean() -> None:
    prepared = _prepared()
    outcome = run_grid_search(prepared, _api())
    prepared.spec = {**prepared.spec, "hyperparameters": outcome.best_hyperparameters}
    result = cv_expanding.run(prepared, _api())

    # Same folds, same estimator -> the search's score IS the strategy's.
    assert outcome.payload["best"]["mean_score"] == pytest.approx(
        result.metrics["cv_rmse_mean"]
    )


def test_mae_ranking_metric_is_reported() -> None:
    prepared = _prepared()
    prepared.spec["rankingMetric"] = "mae"
    outcome = run_grid_search(prepared, _api())
    assert outcome.payload["ranking_metric"] == "mae"
    assert outcome.payload["best"]["mean_score"] > 0


def test_base_values_outside_the_grid_are_kept() -> None:
    outcome = run_grid_search(
        _prepared(base={"alpha": 1.0, "fit_intercept": False}), _api()
    )
    assert all(
        c["hyperparameters"]["fit_intercept"] is False
        for c in outcome.payload["combinations"]
    )


def test_chronological_runs_a_single_fold() -> None:
    outcome = run_grid_search(
        _prepared(split={"method": "chronological", "ratio": 0.8}), _api()
    )
    assert outcome.payload["cv"] is False
    assert outcome.payload["n_folds"] == 1


def test_sequence_algorithm_is_refused() -> None:
    with pytest.raises(RuntimeError, match="tabular-only"):
        run_grid_search(
            _prepared(algorithm="lstm", param_grid={"hidden_size": [8, 16]}), _api()
        )


def test_empty_value_list_is_refused() -> None:
    with pytest.raises(RuntimeError, match="at least one value"):
        run_grid_search(_prepared(param_grid={"alpha": []}), _api())


def test_estimator_survives_clone_and_set_params() -> None:
    estimator = BuildModelEstimator("ridge", {"alpha": 1.0}, 1, {})
    cloned = clone(estimator).set_params(hyperparameters={"alpha": 5.0})
    assert cloned.hyperparameters == {"alpha": 5.0}
    assert estimator.hyperparameters == {"alpha": 1.0}


def test_estimator_translates_through_build_model() -> None:
    frame = _prepared().frame
    estimator = BuildModelEstimator("ridge", {"alpha": 7.0}, 1, {})
    estimator.fit(frame[["x1", "x2"]], frame[TARGET])
    assert estimator.model_.alpha == 7.0


# ── MODEL-FLOW-038: parallel search, within the CPU budget ────────────────────
def test_cpu_budget_reads_the_env_the_backend_sets(monkeypatch) -> None:
    monkeypatch.delenv("TRAINER_CPU_BUDGET", raising=False)
    assert cpu_budget() == 2  # the production quota and sequence_model's default
    monkeypatch.setenv("TRAINER_CPU_BUDGET", "6")
    assert cpu_budget() == 6


@pytest.mark.parametrize("raw", ["0", "-3", "abc", ""])
def test_cpu_budget_is_never_below_one_and_survives_garbage(monkeypatch, raw) -> None:
    monkeypatch.setenv("TRAINER_CPU_BUDGET", raw)
    assert cpu_budget() >= 1


def test_only_the_forests_are_searched_in_parallel() -> None:
    # Measured: extra_trees 83s -> 46s on 2 workers; lightgbm 1.7s -> 2.7s.
    assert PARALLEL_ALGORITHMS == {"random_forest", "extra_trees"}
    assert search_parallelism("extra_trees", 18, 2) == (2, 1)
    for algorithm in ("lightgbm", "xgboost", "ridge", "ols", "pls", "svm", "mlp"):
        assert search_parallelism(algorithm, 18, 2) == (1, 2)


@pytest.mark.parametrize(
    "tasks,budget,expected",
    [
        (18, 2, (2, 1)),  # the production case
        (18, 4, (4, 1)),  # more CPUs -> more workers
        (3, 8, (3, 2)),  # never more workers than fits; the rest are threads
        (1, 4, (1, 4)),  # one fit has nothing to run beside
        (18, 1, (1, 1)),  # a one-CPU budget stays serial
    ],
)
def test_workers_never_exceed_the_budget_or_the_work(tasks, budget, expected) -> None:
    workers, threads = search_parallelism("random_forest", tasks, budget)
    assert (workers, threads) == expected
    assert workers * threads <= max(budget, 1)


def test_parallel_search_ranks_exactly_like_the_serial_one(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(grid_search, "SCRATCH", tmp_path)
    grid = {"n_estimators": [5, 10], "max_depth": [2, 3, None]}

    def run(budget: str):
        monkeypatch.setenv("TRAINER_CPU_BUDGET", budget)
        prepared = _prepared(algorithm="extra_trees", param_grid=grid, base={})
        return run_grid_search(prepared, _api())

    serial, parallel = run("1"), run("2")

    def view(outcome):
        return [
            (c["rank"], c["params"], round(c["mean_score"], 9))
            for c in outcome.payload["combinations"]
        ]

    assert view(parallel) == view(serial)
    assert parallel.best_hyperparameters == serial.best_hyperparameters
    # It really did run in a worker pool, and left its memory-map folder in
    # scratch rather than /dev/shm.
    assert (tmp_path / "joblib").is_dir()

