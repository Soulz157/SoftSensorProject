"""MODEL-SERVE-002-T06. Tests for the recipe-introspection functions moved
here from apps/python — the compounding cases are the point, since a
non-compounding implementation silently under-reports and the number is used
as a REFUSAL threshold on both sides (holdout replay, and /predict's
target-history guard).

These mirror `apps/python/tests/test_feature_spec_quirks.py`'s own
max_replay_lookback cases deliberately: that suite still passes unchanged
against the re-imported name, and these prove the same behaviour from the
package's own side, so a future edit here cannot quietly change what
apps/python depends on.
"""

from __future__ import annotations

import pytest

from softsensor_scaling import (
    FeatureError,
    feature_column_name,
    max_replay_lookback,
)


def test_lookback_is_zero_for_a_recipe_that_reaches_back_no_rows() -> None:
    assert max_replay_lookback([]) == 0
    assert max_replay_lookback([{"kind": "log", "tag": "A"}]) == 0


def test_lookback_reads_lag_k_and_rolling_window_directly() -> None:
    assert max_replay_lookback([{"kind": "lag", "tag": "A", "k": 5}]) == 5
    assert (
        max_replay_lookback(
            [{"kind": "rolling", "tag": "A", "window": 60, "agg": "mean"}]
        )
        == 60
    )
    assert max_replay_lookback([{"kind": "delta", "tag": "A"}]) == 1


def test_lookback_compounds_a_lag_of_a_rolling_column() -> None:
    """The case the original task's own worked example names: lag(5) of
    rolling(60) needs 65, not 5 — reading only the outermost config's own
    window under-counts by the source column's own depth."""
    chained = [
        {"kind": "rolling", "tag": "A", "window": 60, "agg": "mean"},
        {"kind": "lag", "tag": "A__roll60_mean", "k": 5},
    ]
    assert max_replay_lookback(chained) == 65


def test_lookback_does_not_compound_across_independent_tags() -> None:
    independent = [
        {"kind": "rolling", "tag": "A", "window": 60, "agg": "mean"},
        {"kind": "lag", "tag": "B", "k": 5},
    ]
    assert max_replay_lookback(independent) == 60


def test_lookback_takes_the_deeper_of_several_chains() -> None:
    chains = [
        {"kind": "rolling", "tag": "A", "window": 10, "agg": "mean"},
        {"kind": "lag", "tag": "A__roll10_mean", "k": 10},
        {"kind": "lag", "tag": "B", "k": 3},
    ]
    assert max_replay_lookback(chains) == 20


def test_datetime_features_read_no_source_column() -> None:
    """A datetime part is computed from the timestamp alone, so it must not
    inherit a lookback from a same-named tag."""
    assert (
        max_replay_lookback(
            [
                {"kind": "rolling", "tag": "A", "window": 30, "agg": "mean"},
                {"kind": "datetime", "part": "hour"},
            ]
        )
        == 30
    )


def test_feature_column_name_matches_each_kind() -> None:
    assert feature_column_name({"kind": "lag", "tag": "A", "k": 3}) == "A__lag3"
    assert (
        feature_column_name(
            {"kind": "rolling", "tag": "A", "window": 6, "agg": "mean"}
        )
        == "A__roll6_mean"
    )
    assert feature_column_name({"kind": "delta", "tag": "A"}) == "A__delta"
    assert feature_column_name({"kind": "log", "tag": "A"}) == "A__log"
    assert feature_column_name({"kind": "datetime", "part": "hour"}) == "__dt_hour"


def test_unknown_feature_kind_raises_rather_than_guessing_a_name() -> None:
    with pytest.raises(FeatureError, match="Unknown feature kind"):
        feature_column_name({"kind": "not-a-real-kind", "tag": "A"})
