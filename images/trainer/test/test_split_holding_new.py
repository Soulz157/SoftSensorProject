"""MODEL-SERVE-027. splits.chronological_split_holding_new — an Existing +
new retrain must TRAIN on the new rows; the test split is the tail of the
existing rows."""

from __future__ import annotations

import pandas as pd
import pytest

from config import TIMESTAMP_COLUMN
from splits import chronological_split, chronological_split_holding_new

NEW_FROM = pd.Timestamp("2026-01-08 04:00")


def _frame(old: int = 100, new: int = 24) -> pd.DataFrame:
    ts = pd.date_range("2026-01-04 00:00", periods=old, freq="h").append(
        pd.date_range(NEW_FROM, periods=new, freq="h")
    )
    return pd.DataFrame({TIMESTAMP_COLUMN: ts, "y": range(old + new)})


def test_every_new_row_trains_and_the_test_split_is_the_tail_of_the_old_rows() -> None:
    train, test, cut = chronological_split_holding_new(_frame(), 0.7, NEW_FROM)
    assert (train[TIMESTAMP_COLUMN] >= NEW_FROM).sum() == 24
    assert (test[TIMESTAMP_COLUMN] < NEW_FROM).all()
    assert len(test) == 30 and len(train) == 70 + 24
    assert pd.Timestamp(cut) == test[TIMESTAMP_COLUMN].min()


def test_the_bug_it_fixes_a_plain_split_put_every_new_row_in_test() -> None:
    train, _test, _cut = chronological_split(_frame(), 0.7)
    assert (train[TIMESTAMP_COLUMN] >= NEW_FROM).sum() == 0


def test_refuses_rather_than_degrading() -> None:
    with pytest.raises(RuntimeError, match="nothing new to train on"):
        chronological_split_holding_new(_frame(new=0), 0.7, NEW_FROM)
    with pytest.raises(RuntimeError, match="no existing-data test split"):
        chronological_split_holding_new(_frame(old=1), 0.7, NEW_FROM)
