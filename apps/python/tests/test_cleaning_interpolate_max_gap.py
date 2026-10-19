"""Interpolate's optional max gap (2026-10-19).

`param` on an `interpolate` step is the longest run of consecutive non-Good
cells to fill; a longer run is left untouched so a long outage is not bridged
with an invented straight line. The parity fixtures `interpolate_max_gap_*`
prove the browser agrees end to end; these pin the edges the grid cannot reach
(leading/trailing runs, the param reading) and the request-shaped entry point.
"""

from __future__ import annotations

import pandas as pd

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from services.cleaning_service import _max_gap, apply_operations, preprocess_pipelines

G, B = STATUS_GOOD, STATUS_BAD


def frame(values: list[float], statuses: list[int]) -> pd.DataFrame:
    stamps = [f"2026-01-01 {h:02d}:00:00" for h in range(len(values))]
    return pd.DataFrame(
        {
            "timestamp": pd.to_datetime(stamps),
            "T": [float(v) for v in values],
            "T__status": pd.array(statuses, dtype="int8"),
        }
    )


def run(values: list[float], statuses: list[int], **step) -> pd.DataFrame:
    return preprocess_pipelines(
        frame(values, statuses), {"T": [{"method": "interpolate", **step}]}
    )


def test_fills_a_short_gap_and_leaves_a_long_one() -> None:
    # gap of 1 at index 1; gap of 3 at 4..6
    out = run(
        [0, 99, 2, 3, 99, 99, 99, 7],
        [G, B, G, G, B, B, B, G],
        param=2,
    )
    assert out["T"].tolist()[:3] == [0.0, 1.0, 2.0]
    assert out["T__status"].tolist() == [G, G, G, G, B, B, B, G]
    # The long gap keeps its original values.
    assert out["T"].tolist()[4:7] == [99.0, 99.0, 99.0]


def test_a_run_exactly_max_gap_long_is_filled() -> None:
    out = run([0, 99, 99, 3], [G, B, B, G], param=2)
    assert out["T"].tolist() == [0.0, 1.0, 2.0, 3.0]
    assert out["T__status"].tolist() == [G, G, G, G]


def test_leading_and_trailing_runs_obey_the_limit_too() -> None:
    out = run([99, 99, 99, 5, 99], [B, B, B, G, B], param=2)
    assert out["T__status"].tolist() == [B, B, B, G, G]
    assert out["T"].tolist()[4] == 5.0  # carried from its one neighbour


def test_no_param_zero_or_negative_means_no_limit() -> None:
    values, statuses = [0, 99, 99, 99, 4], [G, B, B, B, G]
    plain = run(values, statuses)
    for param in (0, -1):
        assert run(values, statuses, param=param)["T"].tolist() == plain["T"].tolist()
    assert plain["T__status"].tolist() == [G] * 5


def test_param_reading_matches_the_browser() -> None:
    assert _max_gap(None) is None
    assert _max_gap(0) is None
    assert _max_gap(-3) is None
    assert _max_gap(2.9) == 2
    assert _max_gap("x") is None
    assert _max_gap(float("inf")) is None


def test_request_shaped_operation_carries_the_param() -> None:
    out = apply_operations(
        frame([0, 99, 99, 99, 4], [G, B, B, B, G]),
        [{"type": "interpolate", "tags": ["T"], "param": 2}],
    )
    assert out["T__status"].tolist() == [G, B, B, B, G]
