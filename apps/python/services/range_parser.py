"""Parse the free-text `range` column from a feature-preset workbook.

Grammar observed in the reference workbook, not assumed: `"-"` / empty (no
range), `"105-120 C"` (closed, unit optional), `">21500 kg/hr"` / `"<N unit"`
(open-ended), and `"0.85-1.2"` (dimensionless — no unit). The hyphen is BOTH
the range separator and a minus sign, so `"-5-10"` must resolve to
`min=-5, max=10` rather than garbage. Bounds are matched with a number
regex, never `str.split('-')`, so that ambiguity resolves correctly.

DS-LAKE-020-T02.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

#: One signed number, integer or decimal.
_NUMBER = r"-?\d+(?:\.\d+)?"

#: `"105-120 C"`, `"-5-10"`, `"0.85-1.2"` (unit optional, trailing).
_CLOSED_RE = re.compile(
    rf"^({_NUMBER})\s*-\s*({_NUMBER})\s*([A-Za-z°/%][A-Za-z0-9°/%.]*)?$"
)
#: `">21500 kg/hr"`, `"<=13000"`.
_OPEN_RE = re.compile(rf"^(<=|>=|<|>)\s*({_NUMBER})\s*([A-Za-z°/%][A-Za-z0-9°/%.]*)?$")
#: The sheet's own "no range" marker, or a blank cell.
_NONE_RE = re.compile(r"^-?$")


@dataclass(frozen=True)
class ParsedRange:
    """One feature's engineering-range bound, resolved from free text.

    `raw` is retained unconditionally, including when `kind == "none"` because
    parsing failed — an unparseable range stays auditable, never silently
    dropped.
    """

    kind: Literal["none", "closed", "lower", "upper"]
    min: float | None
    max: float | None
    unit: str | None
    raw: str


def parse_range(text: str) -> ParsedRange:
    """Parse one `range` cell.

    Never raises. An unparseable string, or one whose bounds are reversed
    (`min > max`), yields `kind="none"` with `raw` preserved — the caller
    (`_build_feature` in `preset_parser.py`) turns that into a
    `parse_warnings` entry via `range_parse_warning` below, unless `text` was
    the sheet's own empty/`-` marker.
    """
    raw = text.strip()
    if _NONE_RE.match(raw):
        return ParsedRange(kind="none", min=None, max=None, unit=None, raw=raw)

    closed = _CLOSED_RE.match(raw)
    if closed:
        low = float(closed.group(1))
        high = float(closed.group(2))
        unit = (closed.group(3) or "").strip() or None
        if low > high:
            return ParsedRange(kind="none", min=None, max=None, unit=None, raw=raw)
        return ParsedRange(kind="closed", min=low, max=high, unit=unit, raw=raw)

    open_ended = _OPEN_RE.match(raw)
    if open_ended:
        op = open_ended.group(1)
        value = float(open_ended.group(2))
        unit = (open_ended.group(3) or "").strip() or None
        if op in (">", ">="):
            return ParsedRange(kind="lower", min=value, max=None, unit=unit, raw=raw)
        return ParsedRange(kind="upper", min=None, max=value, unit=unit, raw=raw)

    return ParsedRange(kind="none", min=None, max=None, unit=None, raw=raw)


def range_parse_warning(parsed: ParsedRange) -> str | None:
    """A human-readable warning for a range that looked like an attempt but
    could not be resolved. `None` for a genuine `kind="none"` cell (`"-"` or
    empty — the sheet's own no-range marker) and for every successfully
    parsed range."""
    if parsed.kind != "none" or _NONE_RE.match(parsed.raw):
        return None
    return f"Range '{parsed.raw}' could not be parsed as a numeric bound and was not applied."
