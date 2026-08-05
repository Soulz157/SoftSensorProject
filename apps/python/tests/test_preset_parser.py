"""Pins the soft-sensor workbook parser.

Written before `services/preset_parser.py` existed. That ordering is the whole
point of this file: `TAG_RE` was designed by reading a dump of the real workbook
and reasoning about every X cell, and reasoning about a regex is exactly the kind
of argument that feels airtight and is wrong. These cases make it empirical.

The four extraction cases below are the ones that break the obvious
implementation (split on operators):

    (WW001Spgr60/60f.Lab*GG001.PV)/(GG003.PV+GG001.PV)
     ^^^^^^^^^^^^^^^^^^^ one tag, and the slash is INSIDE its name
                                  ^ this slash is division

A parser that treats `/` as an operator shreds the first name; one that treats
`/` as a name character swallows the second expression whole. The dot-suffix
anchor (`.PV`, `.lab`, `.CPV`, `.MV`) is what separates the two, because every
tag in the workbook ends in one and no scale factor does.

Everything here operates on `header=None` frames from `tests/fixtures/
preset_workbook.py` — invented tag names, not the plant's.
"""

from __future__ import annotations

import io
from datetime import datetime

import pandas as pd
import pytest

from services.preset_parser import (
    SdtaRange,
    classify,
    column_map,
    extract_tags,
    find_header_row,
    parse_sdta_sheet,
    parse_unit_sheet,
    parse_workbook,
    preset_document,
    sanitize_feature_name,
)
from tests.fixtures.preset_workbook import sheets, workbook_bytes

# --------------------------------------------------------------------------
# Tag extraction — the four cases that decide whether the regex is correct
# --------------------------------------------------------------------------


def test_a_slash_inside_a_tag_name_does_not_split_the_tag():
    """`WW001Spgr60/60f.Lab` is ONE tag. The real workbook has four of these
    (`S001Spgr60/60f.Lab`, `S002Spgr60/60f.Lab`, ...) and they are the reason
    operator-splitting is not an option."""
    tags = extract_tags("(WW001Spgr60/60f.Lab*GG001.PV)/(GG003.PV+GG001.PV)")

    assert tags[0] == "WW001Spgr60/60f.Lab"
    assert set(tags) == {"WW001Spgr60/60f.Lab", "GG001.PV", "GG003.PV"}


def test_a_slash_between_two_tags_is_division_and_yields_two_tags():
    assert extract_tags("GG226.PV/GG227.PV") == ["GG226.PV", "GG227.PV"]


def test_a_minus_between_two_tags_is_an_operator_and_yields_two_tags():
    """Tag names may contain `-` in other plants, so this is not free."""
    assert extract_tags("TT240.PV-TT239.PV") == ["TT240.PV", "TT239.PV"]


def test_a_trailing_scale_factor_is_not_mistaken_for_a_tag():
    tags = extract_tags("GG204.PV/(YY107.CPV+GG114A.PV)/1000")

    assert tags == ["GG204.PV", "YY107.CPV", "GG114A.PV"]
    assert "1000" not in tags


def test_a_tag_repeated_in_one_expression_is_returned_once_in_first_seen_order():
    assert extract_tags("(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)") == [
        "QQ001A2.PV",
        "GG001.PV",
        "GG003.PV",
    ]


def test_a_blank_or_missing_cell_yields_no_tags():
    assert extract_tags(None) == []
    assert extract_tags(float("nan")) == []
    assert extract_tags("   ") == []


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------


def test_a_lone_tag_is_a_raw_tag():
    assert classify("TT202.PV", ["TT202.PV"]) == "raw_tag"
    assert classify("  TT202.PV  ", ["TT202.PV"]) == "raw_tag"


def test_a_lone_tag_that_happens_to_contain_a_slash_is_still_a_raw_tag():
    """`WW001Spgr60/60f.Lab` on its own is a column, not an expression."""
    assert classify("WW001Spgr60/60f.Lab", ["WW001Spgr60/60f.Lab"]) == "raw_tag"


def test_anything_with_an_operator_is_an_equation():
    assert classify("GG226.PV/GG227.PV", ["GG226.PV", "GG227.PV"]) == "equation"
    assert classify("TT240.PV-TT239.PV", ["TT240.PV", "TT239.PV"]) == "equation"


# --------------------------------------------------------------------------
# Feature naming — must land somewhere recharts can use as a column key
# --------------------------------------------------------------------------


def test_feature_names_are_reduced_to_word_characters():
    assert sanitize_feature_name("Spgr in feed Header#1") == "Spgr_in_feed_Header_1"
    assert sanitize_feature_name("Diff temp inlet/outlet") == "Diff_temp_inlet_outlet"


def test_feature_names_do_not_start_or_end_with_a_separator():
    assert sanitize_feature_name("  (Reflux ratio)  ") == "Reflux_ratio"


# --------------------------------------------------------------------------
# Header discovery
# --------------------------------------------------------------------------


def test_the_header_row_is_found_below_the_title_and_sampling_point_rows():
    frame = sheets()["U-101"]
    assert find_header_row(frame) == 4


def test_a_sheet_without_a_no_y_x_header_has_no_header_row():
    assert find_header_row(sheets()["META"]) is None


def test_columns_are_resolved_by_label_not_position():
    """The second unit sheet says `Range` where the first says `Range control`,
    and has no `effect` column at all. Both must parse."""
    frame = sheets()["U-202"]
    mapping = column_map(frame, find_header_row(frame))

    assert mapping["no"] == 0
    assert mapping["y"] == 1
    assert mapping["x"] == 2
    assert mapping["description"] == 3
    assert mapping["range"] == 4
    assert "effect" not in mapping


# --------------------------------------------------------------------------
# Unit sheet -> presets
# --------------------------------------------------------------------------


@pytest.fixture()
def u101():
    frame = sheets()["U-101"]
    return parse_unit_sheet("U-101", frame)


def test_each_no_starts_a_new_config_block(u101):
    assert [p.config_no for p in u101] == [1, 2]
    assert [p.target_y for p in u101] == ["U101FBP.lab", "U101IBP.lab"]


def test_rows_with_a_blank_no_continue_the_current_block(u101):
    assert len(u101[0].features) == 6


def test_a_block_declaring_a_target_with_no_x_rows_is_kept_and_flagged(u101):
    """The real workbook does this four times (S-202 No.2/3/4, S-206 No.1).
    Dropping them would silently hide targets the engineer wrote down."""
    empty = u101[1]

    assert empty.features == ()
    assert empty.incomplete is True
    assert empty.target_y == "U101IBP.lab"
    assert u101[0].incomplete is False


def test_the_plant_and_sampling_point_are_read_from_above_the_header(u101):
    assert u101[0].plant == "ACME HOT"
    assert u101[0].sampling_point == "RU-101 Overhead"


def test_preset_id_and_name_identify_the_sheet_and_config(u101):
    assert u101[0].preset_id == "u-101-no1"
    assert u101[0].name == "U-101 No.1 — U101FBP.lab"


def test_equation_features_carry_the_original_formula_and_a_safe_name(u101):
    first = u101[0].features[0]

    assert first.type == "equation"
    assert first.name == "Spgr_in_feed_Header_1"
    assert first.formula == "(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)"
    assert first.description == "Spgr in feed Header#1"
    assert first.range == "-"


def test_colliding_descriptions_produce_distinct_feature_names(u101):
    """Two rows share the description `Spgr in feed Header#1`. Both must survive
    — a name collision would mean one engineered column overwrote the other."""
    names = [f.name for f in u101[0].features]

    assert names[0] == "Spgr_in_feed_Header_1"
    assert names[1] == "Spgr_in_feed_Header_1_2"
    assert len(names) == len(set(names))


def test_a_raw_tag_feature_keeps_the_tag_verbatim_as_its_name(u101):
    """Raw tags name existing columns, so they must NOT be sanitised — stripping
    the dot from `TT202.PV` would point the feature at a column that isn't there."""
    raw = [f for f in u101[0].features if f.type == "raw_tag"]

    assert [f.name for f in raw] == ["TT202.PV"]
    assert raw[0].formula is None


def test_a_tag_containing_a_slash_raises_a_parse_warning_for_review(u101):
    """`A/B.PV` is genuinely ambiguous from text alone. The parser commits to a
    reading and says so, rather than guessing silently."""
    with_slash = u101[0].features[1]
    without_slash = u101[0].features[2]

    assert "WW001Spgr60/60f.Lab" in with_slash.required_base_tags
    assert with_slash.parse_warnings != ()
    assert without_slash.parse_warnings == ()


def test_required_base_tags_are_the_deduped_sorted_union_across_features(u101):
    assert u101[0].required_base_tags == (
        "GG001.PV",
        "GG003.PV",
        "GG114A.PV",
        "GG204.PV",
        "GG226.PV",
        "GG227.PV",
        "QQ001A2.PV",
        "TT202.PV",
        "TT239.PV",
        "TT240.PV",
        "WW001Spgr60/60f.Lab",
        "YY107.CPV",
    )


# --------------------------------------------------------------------------
# SD&TA sheet
# --------------------------------------------------------------------------


def test_excel_serial_dates_are_converted_not_passed_through():
    """44805 is not a date, it is a day count from 1899-12-30. Writing it
    through as an integer would produce an exclusion window in 1970."""
    sdta = parse_sdta_sheet(sheets()["SD&TA"])

    assert sdta is not None
    assert sdta.ranges[0].start == "2022-09-01T00:00:00Z"
    assert sdta.ranges[0].end == "2023-01-01T00:00:00Z"
    assert sdta.ranges[1].start == "2023-11-01T00:00:00Z"
    assert len(sdta.ranges) == 2


def test_date_cells_pandas_already_converted_are_accepted():
    """The other direction of the same problem.

    A serial only survives as a number when the cell carries no date format. The
    real workbook DOES format them, so openpyxl hands pandas a `datetime` and the
    serial branch never runs. The synthetic fixture writes plain integers and so
    missed this entirely — it was caught by running the real file, and this test
    is what stops it coming back.
    """
    frame = pd.DataFrame(
        [
            ["From", "To"],
            [datetime(2022, 9, 1), datetime(2023, 1, 1)],
            [pd.Timestamp("2023-11-01"), pd.Timestamp("2024-03-01")],
        ]
    )

    sdta = parse_sdta_sheet(frame)

    assert sdta is not None
    assert sdta.ranges == (
        SdtaRange("2022-09-01T00:00:00Z", "2023-01-01T00:00:00Z"),
        SdtaRange("2023-11-01T00:00:00Z", "2024-03-01T00:00:00Z"),
    )


def test_cut_conditions_are_split_into_tag_operator_and_value():
    sdta = parse_sdta_sheet(sheets()["SD&TA"])

    assert [(c.tag, c.op, c.value) for c in sdta.conditions] == [
        ("GG203.PV", "<", 1700.0),
        ("YY107.CPV", "<", 100.0),
        ("TT202.PV", "<", 100.0),
    ]


# --------------------------------------------------------------------------
# Whole workbook
# --------------------------------------------------------------------------


def test_non_unit_sheets_are_skipped_and_reported_never_offered_as_units():
    """The UI lists units from this result. `SD&TA` and `META` appearing there
    would offer the engineer a preset that cannot exist."""
    parsed = parse_workbook(sheets(), "synthetic.xlsx")

    assert {p.unit for p in parsed.presets} == {"U-101", "U-202"}
    assert parsed.skipped_sheets == ("META",)
    assert parsed.sdta is not None


def test_every_unit_sheet_contributes_its_configs():
    parsed = parse_workbook(sheets(), "synthetic.xlsx")

    assert [p.preset_id for p in parsed.presets] == [
        "u-101-no1",
        "u-101-no2",
        "u-202-no1",
    ]


def test_the_document_is_json_ready_and_records_its_source():
    parsed = parse_workbook(
        sheets(), "synthetic.xlsx", imported_at="2026-08-05T00:00:00Z"
    )
    doc = preset_document(parsed.presets[0], parsed)

    assert doc["preset_id"] == "u-101-no1"
    assert doc["unit"] == "U-101"
    assert doc["config_no"] == 1
    assert doc["target_y"] == "U101FBP.lab"
    assert doc["source"] == {
        "file_name": "synthetic.xlsx",
        "sheet": "U-101",
        "imported_at": "2026-08-05T00:00:00Z",
    }
    assert doc["features"][0]["formula"] == "(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)"
    assert isinstance(doc["required_base_tags"], list)


def test_the_parser_accepts_what_read_excel_actually_produces():
    """Everything above works on hand-built frames. This is the one case that
    proves the hand-built shape matches a real .xlsx round-trip — including that
    `sheet_name=None, header=None` needs no explicit engine on this pandas."""
    frames = pd.read_excel(io.BytesIO(workbook_bytes()), sheet_name=None, header=None)
    parsed = parse_workbook(frames, "synthetic.xlsx")

    assert [p.preset_id for p in parsed.presets] == [
        "u-101-no1",
        "u-101-no2",
        "u-202-no1",
    ]
    assert parsed.presets[0].features[0].formula == (
        "(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)"
    )
