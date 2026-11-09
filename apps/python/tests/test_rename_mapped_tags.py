"""MODEL-SERVE-037-T03: fetched PI tags renamed back to training columns."""

import pandas as pd

from intergrations.object_store import TIMESTAMP_COLUMN, status_column
from services.frame_service import rename_mapped_tags


def _frame(*tags: str) -> pd.DataFrame:
    data: dict[str, list] = {TIMESTAMP_COLUMN: pd.to_datetime(["2026-10-21"])}
    for tag in tags:
        data[tag] = [1.0]
        data[status_column(tag)] = [0]
    return pd.DataFrame(data)


def test_renames_value_and_status_sidecar():
    out = rename_mapped_tags(_frame("PI_A.PV", "B"), {"a": "PI_A.PV", "B": "B"})
    assert list(out.columns) == [
        TIMESTAMP_COLUMN,
        "a",
        status_column("a"),
        "B",
        status_column("B"),
    ]


def test_no_map_returns_frame_unchanged():
    frame = _frame("X")
    assert rename_mapped_tags(frame, None) is frame
    assert rename_mapped_tags(frame, {}) is frame


def test_tag_missing_from_frame_is_left_alone():
    out = rename_mapped_tags(_frame("X"), {"a": "PI_A.PV"})
    assert list(out.columns) == [TIMESTAMP_COLUMN, "X", status_column("X")]
