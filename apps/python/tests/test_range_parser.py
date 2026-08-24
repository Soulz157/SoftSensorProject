"""Pins `services/range_parser.py` against the grammar recorded on the ledger
for the real `s-204-no1` preset (feature_list.preprocessing.json, DS-LAKE-020).

Only the RANGE STRINGS are transcribed here, never tag names or any other
column from that preset — `tests/fixtures/preset_workbook.py`'s own docstring
records that the real workbook's tag names and operating ranges must not enter
git. A bare range string ("105-120 C") carries no such information.

Every case asserts the exact struct, not merely "no exception": a parser that
returned `kind="none"` for everything would still pass a weaker check.
"""

from __future__ import annotations

import pytest

from services.range_parser import ParsedRange, parse_range, range_parse_warning

# --------------------------------------------------------------------------
# The five observed shapes from the real preset, verbatim
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("-", ParsedRange(kind="none", min=None, max=None, unit=None, raw="-")),
        (
            "105-120 C",
            ParsedRange(kind="closed", min=105.0, max=120.0, unit="C", raw="105-120 C"),
        ),
        (
            "132-140 C",
            ParsedRange(kind="closed", min=132.0, max=140.0, unit="C", raw="132-140 C"),
        ),
        (
            "138-150 C",
            ParsedRange(kind="closed", min=138.0, max=150.0, unit="C", raw="138-150 C"),
        ),
        (
            "145-157 C",
            ParsedRange(kind="closed", min=145.0, max=157.0, unit="C", raw="145-157 C"),
        ),
        (
            "155-165 C",
            ParsedRange(kind="closed", min=155.0, max=165.0, unit="C", raw="155-165 C"),
        ),
        (
            ">21500 kg/hr",
            ParsedRange(kind="lower", min=21500.0, max=None, unit="kg/hr", raw=">21500 kg/hr"),
        ),
        (
            ">13000 kg/hr",
            ParsedRange(kind="lower", min=13000.0, max=None, unit="kg/hr", raw=">13000 kg/hr"),
        ),
        (
            "230-300 tph",
            ParsedRange(kind="closed", min=230.0, max=300.0, unit="tph", raw="230-300 tph"),
        ),
        (
            "2.5-10 cP",
            ParsedRange(kind="closed", min=2.5, max=10.0, unit="cP", raw="2.5-10 cP"),
        ),
        (
            "0.85-1.2",
            ParsedRange(kind="closed", min=0.85, max=1.2, unit=None, raw="0.85-1.2"),
        ),
    ],
)
def test_every_observed_shape_parses_to_the_exact_struct(raw, expected):
    assert parse_range(raw) == expected


# --------------------------------------------------------------------------
# The hyphen-is-both-separator-and-minus-sign case — no current preset
# contains a negative bound, but a delta feature or a sub-zero temperature
# will produce one, and a naive `split('-')` mangles it silently.
# --------------------------------------------------------------------------


def test_a_negative_lower_bound_is_not_mangled_by_the_separator():
    assert parse_range("-5-10") == ParsedRange(
        kind="closed", min=-5.0, max=10.0, unit=None, raw="-5-10"
    )


def test_both_bounds_negative_is_not_mangled_by_the_separator():
    assert parse_range("-10--5") == ParsedRange(
        kind="closed", min=-10.0, max=-5.0, unit=None, raw="-10--5"
    )


# --------------------------------------------------------------------------
# Empty / no-range markers — silent, no warning
# --------------------------------------------------------------------------


@pytest.mark.parametrize("raw", ["", "  ", "-"])
def test_the_sheets_own_no_range_marker_is_silent(raw):
    parsed = parse_range(raw)
    assert parsed.kind == "none"
    assert range_parse_warning(parsed) is None


# --------------------------------------------------------------------------
# Unparseable / reversed-bound input — never a silent skip, never a guessed
# or swapped bound
# --------------------------------------------------------------------------


def test_an_unparseable_string_yields_none_with_a_warning():
    parsed = parse_range("abc")
    assert parsed == ParsedRange(kind="none", min=None, max=None, unit=None, raw="abc")
    assert range_parse_warning(parsed) is not None
    assert "abc" in range_parse_warning(parsed)


def test_a_reversed_bound_yields_none_with_a_warning_not_a_swap():
    parsed = parse_range("120-105")
    assert parsed.kind == "none"
    assert parsed.min is None and parsed.max is None
    assert parsed.raw == "120-105"
    assert range_parse_warning(parsed) is not None


# --------------------------------------------------------------------------
# Open-ended operators and whitespace tolerance
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("<100", ParsedRange(kind="upper", min=None, max=100.0, unit=None, raw="<100")),
        ("<=100", ParsedRange(kind="upper", min=None, max=100.0, unit=None, raw="<=100")),
        (">=50 bar", ParsedRange(kind="lower", min=50.0, max=None, unit="bar", raw=">=50 bar")),
        (
            "  105 - 120  C  ",
            ParsedRange(kind="closed", min=105.0, max=120.0, unit="C", raw="105 - 120  C"),
        ),
    ],
)
def test_operators_and_surrounding_whitespace(raw, expected):
    assert parse_range(raw) == expected
