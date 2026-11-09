"""DS-LAKE-038 - a workbook's `Unit` column feeds the range's unit.

ROC COLD's HOT-format workbook writes `45 - 95` under `Range control` and the
unit (`T/H`) in a separate `Unit` column. Before this, every such range was read
as dimensionless and applied as-is, skipping the unit check.
"""

from __future__ import annotations

import pandas as pd

from services.preset_parser import column_map, find_header_row, parse_unit_sheet

HEADER = ["No", "Y", "X", "Unit", "Description", "Range control", "Relation"]


def sheet(rows: list[list[object]]) -> pd.DataFrame:
    """A header=None frame laid out like the converted HOT-format sheets."""
    width = len(HEADER)
    lines: list[list[object]] = [
        ["ROC COLD"] + [None] * (width - 1),
        ["Sampling Point: RS-611"] + [None] * (width - 1),
        [None] * width,
        HEADER,
        *rows,
    ]
    return pd.DataFrame(lines, dtype=object)


def ranges(frame: pd.DataFrame) -> dict[str, tuple[str, object]]:
    preset = parse_unit_sheet("RS-611", frame)[0]
    return {f.name: (f.range_parsed.kind, f.range_parsed.unit) for f in preset.features}


def test_the_unit_header_is_mapped():
    frame = sheet([[1, "s611water.lab", "FIC505.PV", "T/H", "feed", "45 - 95", "r"]])
    mapping = column_map(frame, find_header_row(frame))
    assert mapping["unit"] == 3
    assert mapping["range"] == 5


def test_a_bare_range_takes_its_unit_from_the_unit_column():
    frame = sheet(
        [
            [1, "s611water.lab", "FIC505.PV", "T/H", "feed", "45 - 95", "r"],
            [None, None, "LI602.PV", "%", "level", "0 - 5", "r"],
        ]
    )
    assert ranges(frame) == {
        "FIC505.PV": ("closed", "T/H"),
        "LI602.PV": ("closed", "%"),
    }


def test_a_unit_written_in_the_range_cell_wins():
    frame = sheet([[1, "y.lab", "TI101.PV", "C", "temp", "105-120 F", "r"]])
    assert ranges(frame)["TI101.PV"] == ("closed", "F")


def test_a_blank_or_dash_unit_cell_leaves_the_range_without_a_unit():
    frame = sheet(
        [
            [1, "y.lab", "PI101.PV", "-", "p", "2 - 4", "r"],
            [None, None, "PI102.PV", None, "p", "2 - 4", "r"],
        ]
    )
    assert ranges(frame) == {
        "PI101.PV": ("closed", None),
        "PI102.PV": ("closed", None),
    }


def test_a_row_without_a_range_gets_no_unit():
    frame = sheet([[1, "y.lab", "FI101.PV", "T/H", "flow", "-", "r"]])
    assert ranges(frame)["FI101.PV"] == ("none", None)


def test_a_sheet_without_a_unit_column_is_unchanged():
    width = 6
    frame = pd.DataFrame(
        [
            ["U-202"] + [None] * (width - 1),
            ["Sampling Point: X"] + [None] * (width - 1),
            [None] * width,
            ["No", "Y", "X", "Description", "Range", "Relation"],
            [1, "y.lab", "FI101.PV", "flow", "45 - 95", "r"],
        ],
        dtype=object,
    )
    preset = parse_unit_sheet("U-202", frame)[0]
    assert preset.features[0].range_parsed.unit is None
    assert preset.features[0].range_parsed.kind == "closed"
