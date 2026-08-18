"""DS-LAKE-005B-D-T04 / DS-LAKE-005B-D-V03.

Proves the task's own HARD REQUIREMENT: regression coefficients are fitted
over the FULL Good-filtered frame, never the decimated `points` sample.

This is deliberately NOT provable with an arbitrary linear or noisy-linear
fixture — any subset of a line fits the same slope as the full line, and a
tight noisy band's decimated subset lands close enough to the full-frame
fit that a fit-on-sample bug would pass by coincidence (both mistakes made
during this task's own live TestClient smoke check, corrected here).

The discriminating construction is a LEVERAGE-POINT frame: a large cluster
on one trend, plus a few points far out in x on a DIFFERENT trend. Grid
binning collapses the dense cluster to a handful of representative points
while keeping every far-out leverage point (each is its own occupied grid
cell). A regression fit on `points` therefore weighs the few leverage
points far more heavily than a regression fit on the full `n` does — the
two fits provably diverge. If `build_scatter` ever started fitting on the
sample, this test's second assertion would start failing.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from schemas.preprocess import ScatterRequest
from services.downsample import grid_bin_indices
from services.scatter_service import _linear_regression, build_scatter


class _NoWriteStore:
    """Read-only fake — same guarantee `test_preview_service.NoWriteStore`
    makes, defined locally per this codebase's own precedent (each service
    test owns its store fake; `test_chart_parity.py::_ReadOnlyStore` does
    the same for histogram/boxplot/scatter's chart-parity gate)."""

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        return self._frame[columns].copy() if columns else self._frame.copy()

    def __getattr__(self, name: str):
        raise AssertionError(
            f"scatter service called {name!r} on the object store — "
            "read-only, must not write, delete, or create anything."
        )


def _leverage_frame(cluster_n: int = 500) -> pd.DataFrame:
    """500 Good pairs tightly clustered on `y = x` near the origin, plus 3
    Good pairs at moderate x (≈2.0–2.6) on a DIFFERENT trend (y = -x).

    NOTE ON THE CONSTRUCTION — an earlier version of this fixture placed the
    leverage points far out (x≈1000), which is WRONG: OLS weight scales with
    squared distance from the mean, so points that far out dominate the
    FULL-frame fit just as much as any decimated sample of it (that is
    literally what "leverage" means) — full and sample slopes both landed
    ≈-1 and the discriminating assertion below failed. Moderate leverage
    (x≈2–2.6, close enough that the 500-point cluster's sheer COUNT still
    wins the full-frame fit) is what actually separates the two: `grid_
    bin_indices` collapses the near-degenerate cluster line to a handful of
    representative points while keeping the sparse leverage points (each
    its own occupied cell) — verified against the REAL sampler, not
    assumed, in `test_full_frame_and_decimated_sample_provably_disagree`.
    """
    rng = np.random.default_rng(20260816)
    cluster_x = rng.uniform(-1, 1, cluster_n)
    cluster_y = cluster_x + rng.normal(0, 0.01, cluster_n)

    leverage_x = np.array([2.0, 2.3, 2.6])
    leverage_y = -leverage_x  # opposing trend

    x = np.concatenate([cluster_x, leverage_x])
    y = np.concatenate([cluster_y, leverage_y])
    n = x.size

    ts = pd.date_range("2026-06-22", periods=n, freq="min")
    return pd.DataFrame(
        {
            "timestamp": ts,
            "TI-101": x,
            "TI-101__status": np.full(n, STATUS_GOOD, dtype="int8"),
            "VI-202": y,
            "VI-202__status": np.full(n, STATUS_GOOD, dtype="int8"),
        }
    )


def test_full_frame_and_decimated_sample_provably_disagree():
    """Sanity check on the FIXTURE itself, not the service: proves the
    leverage-point construction actually creates the divergence this test
    relies on, using the REAL `grid_bin_indices` sampler — not a
    hand-picked index set standing in for it. If this assertion ever
    fails, the fixture stopped discriminating and the test below would be
    trivially satisfiable — this is what stops that from happening
    silently."""
    frame = _leverage_frame()
    x = frame["TI-101"].to_numpy()
    y = frame["VI-202"].to_numpy()

    full = _linear_regression(x, y)
    sample_result = grid_bin_indices(x, y, 20)
    sample = _linear_regression(x[sample_result.indices], y[sample_result.indices])

    assert full["slope"] > 0.5  # dominated by the y=x cluster's sheer count
    assert sample["slope"] < 0  # pulled toward the opposing leverage trend
    assert not math.isclose(full["slope"], sample["slope"], rel_tol=0.1)


def test_scatter_regression_uses_full_frame_not_decimated_sample():
    frame = _leverage_frame()
    store = _NoWriteStore(frame)

    request = ScatterRequest(
        source_key="fixture/leverage.parquet",
        x_tag="TI-101",
        y_tag="VI-202",
        max_points=20,  # forces real decimation of the 500-point cluster
    )
    response = build_scatter(store, request)

    full_regression = _linear_regression(
        frame["TI-101"].to_numpy(), frame["VI-202"].to_numpy()
    )

    # 1. The response's coefficients match the FULL-FRAME fit exactly.
    assert math.isclose(
        response["slope"], full_regression["slope"], rel_tol=1e-9, abs_tol=1e-12
    )
    assert math.isclose(
        response["intercept"],
        full_regression["intercept"],
        rel_tol=1e-9,
        abs_tol=1e-12,
    )

    # 2. THE BITING ASSERTION: a regression fit over the RETURNED (decimated)
    # points does NOT match — proving the response isn't fitting on its own
    # sample. A fit-on-sample implementation would make this assertion FAIL
    # (the two would agree), which is exactly the bug this test exists to
    # catch — see this module's own docstring.
    points = response["points"]
    sample_x = np.array([p["x"] for p in points])
    sample_y = np.array([p["y"] for p in points])
    sample_regression = _linear_regression(sample_x, sample_y)
    assert not math.isclose(
        response["slope"], sample_regression["slope"], rel_tol=0.1
    ), (
        "response['slope'] matches a fit over the decimated `points` sample "
        "— the fixture's leverage points should have pulled a sample-only "
        "fit toward a different slope than the full-frame fit."
    )

    # 3. `n` is the TRUE full Good-pair count; `points` is strictly smaller.
    assert response["n"] == 503
    assert len(response["points"]) < response["n"]
    assert response["downsampled"] is True


def test_scatter_excludes_bad_pairs_from_n_and_regression():
    """ADR-DS-LAKE-005B-D-scatter-status-filter: a pair counts only when
    BOTH x and y are Good. Bad cells hold the `0.0` MISSING_VALUE hole on a
    real artifact — if they leaked into `n` or the fit, a straight line
    would bend toward the origin."""
    n_good = 50
    x = np.linspace(1, 50, n_good)
    y = 2.0 * x + 3.0
    ts = pd.date_range("2026-06-22", periods=n_good + 2, freq="min")

    x_full = np.concatenate([x, [0.0, 0.0]])  # Bad holes
    y_full = np.concatenate([y, [0.0, 0.0]])
    x_status = np.full(n_good + 2, STATUS_GOOD, dtype="int8")
    y_status = np.full(n_good + 2, STATUS_GOOD, dtype="int8")
    x_status[-2:] = STATUS_BAD
    y_status[-1] = STATUS_BAD  # only one of the two holes flagged on y

    frame = pd.DataFrame(
        {
            "timestamp": ts,
            "TI-101": x_full,
            "TI-101__status": x_status,
            "VI-202": y_full,
            "VI-202__status": y_status,
        }
    )
    store = _NoWriteStore(frame)
    request = ScatterRequest(
        source_key="fixture/bad-pairs.parquet", x_tag="TI-101", y_tag="VI-202"
    )
    response = build_scatter(store, request)

    assert response["n"] == n_good
    assert math.isclose(response["slope"], 2.0, rel_tol=1e-9, abs_tol=1e-9)
    assert math.isclose(response["intercept"], 3.0, rel_tol=1e-9, abs_tol=1e-9)


def test_scatter_service_never_writes():
    frame = _leverage_frame()
    store = _NoWriteStore(frame)
    with pytest.raises(AssertionError, match="read-only"):
        store.put_frame
