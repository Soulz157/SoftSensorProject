"""Synthetic soft-sensor workbook, built in memory.

Deliberately NOT the real plant file. The production workbook carries live tag
names, real operating ranges and operator notes about plant behaviour; none of
that belongs in git. What matters for the parser is the *shape*, so this module
rebuilds every structural quirk with invented names:

  * a tag whose own name contains a slash          (`WW001Spgr60/60f.Lab`)
  * a slash used as division between two tags      (`GG226.PV/GG227.PV`)
  * a minus used as an operator between two tags   (`TT240.PV-TT239.PV`)
  * a trailing `/1000` scale factor that is not a tag
  * a config block that declares a Y with no X rows
  * header labels that drift between sheets, and a sheet missing a column
  * a sheet that is not a unit at all and must be skipped
  * an SD&TA sheet holding Excel serial dates and cut conditions

The sheets are returned as `header=None` DataFrames — the same thing
`pd.read_excel(..., sheet_name=None, header=None)` hands the parser — so the
pure functions can be tested without touching the filesystem. `workbook_bytes()`
additionally renders a real .xlsx for the one test that exercises the
pandas/openpyxl round-trip.
"""

from __future__ import annotations

import io

import pandas as pd

#: Marks an empty cell. `pd.read_excel` yields NaN, and the parser must treat a
#: NaN and an empty string identically, so the fixture uses the real thing.
BLANK = float("nan")


def unit_sheet_rows() -> list[list[object]]:
    """A unit sheet with two config blocks, the second one empty.

    Row 4 is the header. Rows 5-10 are config No.1; row 11 is blank; row 12
    starts config No.2, which declares a target and then stops — the real
    workbook does this four times and the parser must not drop those blocks.
    """
    return [
        ["ACME HOT", BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        ["Sampling Point: RU-101 Overhead ", BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        ["No", "Y", "X", "Description ", "Range control", "Relation", "effect"],
        [
            "1",
            "U101FBP.lab",
            "(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)",
            "Spgr in feed Header#1",
            "-",
            "heavier feed raises FBP",
            "+",
        ],
        [
            BLANK,
            BLANK,
            "(WW001Spgr60/60f.Lab*GG001.PV)/(GG003.PV+GG001.PV)",
            # Same description as the row above on purpose: the generated
            # feature names collide and must be disambiguated, not overwritten.
            "Spgr in feed Header#1",
            "-",
            "lab-substituted variant",
            "+",
        ],
        [BLANK, BLANK, "GG226.PV/GG227.PV", "Stripping ratio", "0.03-0.05", "", "-"],
        [BLANK, BLANK, "TT240.PV-TT239.PV", "Diff temp inlet/outlet", "-", "", "-"],
        [
            BLANK,
            BLANK,
            "GG204.PV/(YY107.CPV+GG114A.PV)/1000",
            "Reflux ratio per total feed",
            "0.85-1.2",
            "",
            "-",
        ],
        [BLANK, BLANK, "TT202.PV", "Temp overhead", "105-120 C", "", "+"],
        [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        ["2", "U101IBP.lab", BLANK, BLANK, BLANK, BLANK, BLANK],
    ]


def drifted_sheet_rows() -> list[list[object]]:
    """A second unit sheet whose header labels differ and whose `effect` column
    is absent entirely — both true of the real workbook. Column positions are
    unchanged here, so a parser that resolved by index would still pass; the
    drift that must be handled is the *labels*.
    """
    return [
        ["ACME HOT", BLANK, BLANK, BLANK, BLANK, BLANK],
        ["Sampling Point: RU-202 Process Water", BLANK, BLANK, BLANK, BLANK, BLANK],
        [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
        ["No", "Y", "X", "Description", "Range", "Relation"],
        # Open-ended (DS-LAKE-020-T02): an operating window, not a closed
        # validity band — the grammar case the ledger calls out separately.
        ["1", "U202OIL.lab", "PP226.PV", "pH analyzer", ">21500 kg/hr", "note"],
        # Closed, negative lower bound: the hyphen is both separator and minus
        # sign here, which a naive `split('-')` would mangle silently.
        [BLANK, BLANK, "PP227.PV/PP226.PV", "Ratio", "-5-10", "note"],
    ]


def non_unit_sheet_rows() -> list[list[object]]:
    """A sheet with no No/Y/X header. Must be skipped, never listed as a unit."""
    return [
        ["Revision", "Author", "Date"],
        ["1.0", "redacted", "2026-01-02"],
    ]


def sdta_sheet_rows() -> list[list[object]]:
    """Shutdown / turnaround windows plus the conditions that mark one.

    Dates are Excel serials, exactly as they arrive from the real sheet — the
    parser converting them is the point. 44805 -> 2022-09-01, 44927 -> 2023-01-01
    (day count from the 1899-12-30 epoch, not from 1970).
    """
    return [
        ["From", "To"],
        [44805, 44927],
        [45231, 45352],
        [BLANK, BLANK],
        ["Condition SD/TA", BLANK],
        ["GG203.PV", "<1700"],
        ["YY107.CPV", "<100"],
        ["TT202.PV", "<100"],
    ]


def sheets() -> dict[str, pd.DataFrame]:
    """The workbook as `header=None` frames, in sheet order."""
    return {
        "U-101": pd.DataFrame(unit_sheet_rows()),
        "U-202": pd.DataFrame(drifted_sheet_rows()),
        "META": pd.DataFrame(non_unit_sheet_rows()),
        "SD&TA": pd.DataFrame(sdta_sheet_rows()),
    }


def workbook_bytes() -> bytes:
    """Render the same sheets to a real .xlsx, for the read_excel round-trip."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, frame in sheets().items():
            frame.to_excel(writer, sheet_name=name, header=False, index=False)
    return buffer.getvalue()
