"""`group` feature kind and cyclic datetime parts (2026-10-19).

The parity fixtures (`feature_group_aggregates`, `feature_datetime_cyclic`)
prove the browser and this port agree on values. These pin what the grid
cannot: a group's `name` is its OUTPUT COLUMN through every server path that
reads `name` that way (feature_spec.json, holdout replay rebuild,
max_replay_lookback compounding), and the request schema accepts the kind.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from softsensor_scaling import feature_column_name, max_replay_lookback

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    status_column,
)
from schemas.preprocess import FeatureConfigRequest
from services.feature_service import apply_features

GROUP = {
    "id": "auto:1",
    "kind": "group",
    "name": "AI602__grp_mean",
    "tags": ["AI602A", "AI602B"],
    "agg": "mean",
}


def frame(
    a: list[float], b: list[float], bad_b: set[int] = frozenset()
) -> pd.DataFrame:
    n = len(a)
    df = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.date_range("2026-01-05", periods=n, freq="h").strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "AI602A": a,
            "AI602B": b,
        }
    )
    df[status_column("AI602A")] = np.full(n, STATUS_GOOD, dtype="int8")
    df[status_column("AI602B")] = np.array(
        [STATUS_BAD if i in bad_b else STATUS_GOOD for i in range(n)], dtype="int8"
    )
    return df


def test_group_is_bad_when_any_member_is_bad() -> None:
    out = apply_features(frame([1.0, 2.0, 3.0], [3.0, 4.0, 5.0], bad_b={1}), [GROUP])
    assert out["AI602__grp_mean"].tolist() == [2.0, 0.0, 4.0]
    assert out[status_column("AI602__grp_mean")].tolist() == [
        STATUS_GOOD,
        STATUS_BAD,
        STATUS_GOOD,
    ]


def test_every_aggregate() -> None:
    df = frame([1.0], [4.0])
    out = apply_features(
        df,
        [
            {**GROUP, "name": f"L__grp_{agg}", "agg": agg, "id": agg}
            for agg in ("mean", "min", "max", "spread", "std")
        ],
    )
    assert out.loc[0, "L__grp_mean"] == 2.5
    assert out.loc[0, "L__grp_min"] == 1.0
    assert out.loc[0, "L__grp_max"] == 4.0
    assert out.loc[0, "L__grp_spread"] == 3.0
    assert math.isclose(out.loc[0, "L__grp_std"], 3 / math.sqrt(2))


def test_name_is_the_column_through_spec_and_replay() -> None:
    assert feature_column_name(GROUP) == "AI602__grp_mean"
    # The replay rebuild: spec entry -> FeatureConfigRequest(id=name, name=name).
    spec_entry = {
        "name": "AI602__grp_mean",
        "config": {k: v for k, v in GROUP.items() if k not in ("id", "name")},
    }
    rebuilt = FeatureConfigRequest(
        id=spec_entry["name"], name=spec_entry["name"], **spec_entry["config"]
    ).to_step()
    assert rebuilt["kind"] == "group"
    assert feature_column_name(rebuilt) == "AI602__grp_mean"


def test_lookback_compounds_through_a_group_column() -> None:
    lagged = {"id": "auto:2", "kind": "lag", "tag": "AI602__grp_mean", "k": 3}
    rolled_member = {
        "id": "auto:0",
        "kind": "rolling",
        "tag": "AI602A",
        "window": 4,
        "agg": "mean",
    }
    assert max_replay_lookback([GROUP, lagged]) == 3
    # A group reading a rolled member inherits the member's lookback.
    grouped_roll = {**GROUP, "tags": ["AI602A__roll4_mean", "AI602B"]}
    assert max_replay_lookback([rolled_member, grouped_roll, lagged]) == 7


def test_cyclic_parts_match_the_formula() -> None:
    df = frame([0.0] * 30, [0.0] * 30)
    out = apply_features(
        df,
        [
            {"id": "s", "kind": "datetime", "part": "hourSin"},
            {"id": "c", "kind": "datetime", "part": "dayOfWeekCos"},
        ],
    )
    # Row 6 is 06:00 on Monday 2026-01-05 (JS day 1).
    assert math.isclose(out.loc[6, "__dt_hourSin"], 1.0)
    assert math.isclose(out.loc[6, "__dt_dayOfWeekCos"], math.cos(2 * math.pi / 7))
