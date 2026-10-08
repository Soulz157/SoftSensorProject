"""Parse a soft-sensor engineering workbook into feature presets.

Pure: every function here takes frames and returns values. No object storage, no
FastAPI, no filesystem — `services/preset_service.py` owns all of that. Keeping
the split means the parsing rules, which are the fiddly part, are testable
against hand-built frames.

Workbook shape
--------------
One sheet per process unit, plus non-unit sheets that must be ignored. A unit
sheet looks like::

    r2  ROC HOT                                   <- plant / operating mode
    r3  Sampling Point: RS-204 Reflux
    r5  No | Y | X | Description | Range control | Relation | effect
    r6  1  | S204FBP.lab | (AI001A2.PV*FI001.PV)/(FI003.PV+FI001.PV) | ...
    r7     |             | TI202.PV                                   | ...
    r22 (blank)
    r23 2  | S204IBP.lab | ...

A value in `No` opens a config block; rows below it with a blank `No` belong to
that block until the next one. Column POSITIONS are stable in practice but the
LABELS drift between sheets (`range` / `Range control` / `Range`, and one sheet
has no `effect` column at all), so columns are resolved by label.

Why the tag regex looks the way it does
---------------------------------------
Tag names may contain a slash: `S001Spgr60/60f.Lab` is a single tag. A slash is
ALSO the division operator: `FIC226.PV/FIC227.PV` is two tags. Splitting on
operators corrupts the first; treating `/` as an ordinary name character
swallows the second. What separates them is that every tag ends in a dot-suffix
(`.PV`, `.CPV`, `.MV`, `.lab`, `.Lab`) and no scale factor does — so the match is
anchored on the dot and stops there.

`A/B.PV` remains genuinely ambiguous from text alone (is it one tag, or `A`
divided by `B.PV`?). The parser commits to reading it as one tag and records a
`parse_warning` so the UI can ask a human, rather than guessing in silence.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Sequence

import pandas as pd

from services.range_parser import ParsedRange, parse_range, range_parse_warning

#: A plant tag: leading letter, then name characters that MAY include a slash,
#: terminated by a dot-suffix. The dot is what stops the match, which is what
#: keeps `FIC226.PV/FIC227.PV` from collapsing into one token.
TAG_RE = re.compile(r"[A-Za-z][A-Za-z0-9/]*\.[A-Za-z][A-Za-z0-9]*")

#: A cut condition on the SD&TA sheet, e.g. `<1700`.
CONDITION_RE = re.compile(r"^(<=|>=|<|>|==|=)\s*(-?\d+(?:\.\d+)?)$")

#: Excel's day-count origin. NOT the Unix epoch — reading a serial as a Unix
#: timestamp silently places every shutdown window in 1970.
EXCEL_EPOCH = datetime(1899, 12, 30)

#: Header labels -> canonical column key. Matched against a casefolded, stripped
#: cell; the `range`/`description`/`effect` entries match by prefix because the
#: sheets append qualifiers (`Range control`, `effect กับ Y`).
_EXACT_LABELS = {"no": "no", "y": "y", "x": "x", "relation": "relation"}
_PREFIX_LABELS = (
    ("description", "description"),
    ("range", "range"),
    ("effect", "effect"),
)

#: Columns without which a sheet is not a unit sheet.
_REQUIRED_COLUMNS = ("no", "y", "x")

_SAMPLING_POINT_PREFIX = "sampling point"


@dataclass(frozen=True)
class PresetFeature:
    """One X row: either a raw tag or an equation over raw tags."""

    #: `'equation'` or `'raw_tag'`.
    type: str
    #: For an equation, the sanitised column name the engineered feature will
    #: take. For a raw tag, the tag itself, VERBATIM — sanitising it would point
    #: the feature at a column that does not exist.
    name: str
    #: The original expression, exactly as written. `None` for a raw tag.
    formula: str | None
    description: str
    range: str
    #: `range` resolved to a numeric bound. DS-LAKE-020-T02.
    range_parsed: ParsedRange
    relation: str
    required_base_tags: tuple[str, ...]
    #: Non-fatal ambiguities a human should confirm.
    parse_warnings: tuple[str, ...]


@dataclass(frozen=True)
class Preset:
    """One `No.` block: a target and the features that predict it."""

    preset_id: str
    unit: str
    config_no: int
    name: str
    plant: str
    sampling_point: str
    target_y: str
    features: tuple[PresetFeature, ...]
    #: Deduped, sorted union of every feature's base tags.
    required_base_tags: tuple[str, ...]
    #: True when the sheet declared a target but listed no X rows. Kept rather
    #: than dropped: the engineer wrote the target down, and silently losing it
    #: is worse than surfacing an unusable preset.
    incomplete: bool


@dataclass(frozen=True)
class SdtaRange:
    """A shutdown / turnaround window, ISO-8601 UTC."""

    start: str
    end: str


@dataclass(frozen=True)
class SdtaCondition:
    """A reading that marks the plant as down, e.g. `FIC203.PV < 1700`."""

    tag: str
    op: str
    value: float


@dataclass(frozen=True)
class SdtaConfig:
    ranges: tuple[SdtaRange, ...]
    conditions: tuple[SdtaCondition, ...]


@dataclass(frozen=True)
class WorkbookParse:
    presets: tuple[Preset, ...]
    sdta: SdtaConfig | None
    #: Sheets with no No/Y/X header. Reported so the UI can say what it ignored
    #: instead of leaving the engineer to wonder where a sheet went.
    skipped_sheets: tuple[str, ...]
    file_name: str
    imported_at: str
    #: unit -> source sheet name. They are equal today; the indirection keeps
    #: `preset_document` honest if a unit is ever renamed for display.
    sheet_by_unit: Mapping[str, str]


# ---------------------------------------------------------------------------
# Cell helpers
# ---------------------------------------------------------------------------


def _text(value: Any) -> str:
    """A cell as trimmed text. NaN, None and whitespace all read as empty."""
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    if value is not value:  # NaT and other NA sentinels are not self-equal
        return ""
    return str(value).strip()


def _raw(frame: pd.DataFrame, row: int, column: int) -> Any:
    """The cell UNCONVERTED.

    Needed by the SD&TA date reader: a date-formatted cell reaches pandas as a
    `datetime`, and stringifying it first destroys the only signal that it is
    already a date rather than a day-count.
    """
    if column >= frame.shape[1]:
        return None
    return frame.iat[row, column]


def _cell(frame: pd.DataFrame, row: int, column: int | None) -> str:
    if column is None or column >= frame.shape[1]:
        return ""
    return _text(frame.iat[row, column])


# ---------------------------------------------------------------------------
# Tag extraction and classification
# ---------------------------------------------------------------------------


def extract_tags(cell: Any) -> list[str]:
    """Every plant tag in an expression, deduped, in first-seen order."""
    text = _text(cell)
    if not text:
        return []

    seen: dict[str, None] = {}
    for match in TAG_RE.finditer(text):
        seen.setdefault(match.group(0), None)
    return list(seen)


def classify(cell: Any, tags: Sequence[str]) -> str:
    """`'raw_tag'` when the cell is nothing but a single tag, else `'equation'`."""
    text = _text(cell)
    if len(tags) == 1 and tags[0] == text:
        return "raw_tag"
    return "equation"


def _tag_warnings(tags: Iterable[str]) -> tuple[str, ...]:
    return tuple(
        f"'{tag}' was read as one tag, but the slash could also be division. "
        "Confirm this against the tag list."
        for tag in tags
        if "/" in tag
    )


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------


def sanitize_feature_name(text: str) -> str:
    """Reduce a description to a column key charting can use.

    Mirrors `sanitizeName` in the client's feature-creation panel: the generated
    column becomes a tag, and recharts keys break on dots and spaces.
    """
    return re.sub(r"[^A-Za-z0-9]+", "_", text.strip()).strip("_")


def _unique_name(base: str, taken: set[str]) -> str:
    """Disambiguate a repeated name. Two X rows legitimately share a
    description (`Spgr in feed Header#1` appears twice on S-204), and letting
    them collide would mean one engineered column overwrote the other."""
    if base not in taken:
        taken.add(base)
        return base

    suffix = 2
    while f"{base}_{suffix}" in taken:
        suffix += 1
    unique = f"{base}_{suffix}"
    taken.add(unique)
    return unique


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")


# ---------------------------------------------------------------------------
# Header discovery
# ---------------------------------------------------------------------------


def find_header_row(frame: pd.DataFrame) -> int | None:
    """Index of the `No | Y | X` header, or `None` when this is not a unit sheet."""
    for row in range(frame.shape[0]):
        labels = {
            _text(frame.iat[row, column]).casefold()
            for column in range(frame.shape[1])
        }
        if all(required in labels for required in _REQUIRED_COLUMNS):
            return row
    return None


def column_map(frame: pd.DataFrame, header_row: int | None) -> dict[str, int]:
    """Canonical column key -> index, resolved by LABEL.

    Positions happen to be stable across the sample workbook, but the labels are
    what the sheets actually agree on, and one sheet is missing a column
    entirely — so an index-based reader would drift the moment a column is
    inserted.
    """
    if header_row is None:
        return {}

    mapping: dict[str, int] = {}
    for column in range(frame.shape[1]):
        label = _text(frame.iat[header_row, column]).casefold()
        if not label:
            continue

        key = _EXACT_LABELS.get(label)
        if key is None:
            key = next(
                (k for prefix, k in _PREFIX_LABELS if label.startswith(prefix)), None
            )
        if key is not None:
            mapping.setdefault(key, column)
    return mapping


def _header_context(frame: pd.DataFrame, header_row: int) -> tuple[str, str]:
    """`(plant, sampling_point)` from the free-text rows above the header."""
    plant = ""
    sampling_point = ""

    for row in range(header_row):
        text = _cell(frame, row, 0)
        if not text:
            continue
        if text.casefold().startswith(_SAMPLING_POINT_PREFIX):
            _, _, value = text.partition(":")
            sampling_point = value.strip()
        elif not plant:
            plant = text

    return plant, sampling_point


# ---------------------------------------------------------------------------
# Unit sheets
# ---------------------------------------------------------------------------


def _config_number(text: str) -> int | None:
    try:
        return int(float(text))
    except ValueError:
        return None


def _build_feature(
    frame: pd.DataFrame,
    row: int,
    columns: Mapping[str, int],
    taken: set[str],
) -> PresetFeature | None:
    expression = _cell(frame, row, columns["x"])
    if not expression:
        return None

    tags = extract_tags(expression)
    kind = classify(expression, tags)
    description = _cell(frame, row, columns.get("description"))

    if kind == "raw_tag":
        name = _unique_name(expression, taken)
        formula = None
    else:
        base = sanitize_feature_name(description) or f"feature_{len(taken) + 1}"
        name = _unique_name(base, taken)
        formula = expression

    range_text = _cell(frame, row, columns.get("range"))
    range_parsed = parse_range(range_text)
    warnings = _tag_warnings(tags)
    range_warning = range_parse_warning(range_parsed)
    if range_warning is not None:
        warnings = warnings + (range_warning,)

    return PresetFeature(
        type=kind,
        name=name,
        formula=formula,
        description=description,
        range=range_text,
        range_parsed=range_parsed,
        relation=_cell(frame, row, columns.get("relation")),
        required_base_tags=tuple(tags),
        parse_warnings=warnings,
    )


def _finish_preset(
    unit: str,
    config_no: int,
    target_y: str,
    plant: str,
    sampling_point: str,
    features: list[PresetFeature],
) -> Preset:
    required = sorted(
        {tag for feature in features for tag in feature.required_base_tags}
    )
    return Preset(
        preset_id=f"{_slug(unit)}-no{config_no}",
        unit=unit,
        config_no=config_no,
        name=f"{unit} No.{config_no} — {target_y}",
        plant=plant,
        sampling_point=sampling_point,
        target_y=target_y,
        features=tuple(features),
        required_base_tags=tuple(required),
        incomplete=not features,
    )


def parse_unit_sheet(unit: str, frame: pd.DataFrame) -> list[Preset]:
    """Every `No.` block on one unit sheet. Empty when the sheet is not a unit."""
    header_row = find_header_row(frame)
    if header_row is None:
        return []

    columns = column_map(frame, header_row)
    if not all(key in columns for key in _REQUIRED_COLUMNS):
        return []

    plant, sampling_point = _header_context(frame, header_row)

    presets: list[Preset] = []
    state: dict[str, Any] = {"config_no": None, "target_y": "", "features": []}
    taken: set[str] = set()

    def flush() -> None:
        if state["config_no"] is not None:
            presets.append(
                _finish_preset(
                    unit,
                    state["config_no"],
                    state["target_y"],
                    plant,
                    sampling_point,
                    state["features"],
                )
            )

    for row in range(header_row + 1, frame.shape[0]):
        marker = _config_number(_cell(frame, row, columns["no"]))
        if marker is not None:
            flush()
            state = {
                "config_no": marker,
                "target_y": _cell(frame, row, columns["y"]),
                "features": [],
            }
            taken = set()

        if state["config_no"] is None:
            # Stray rows above the first `No` belong to no block.
            continue

        feature = _build_feature(frame, row, columns, taken)
        if feature is not None:
            state["features"].append(feature)

    flush()
    return presets


# ---------------------------------------------------------------------------
# SD&TA sheet
# ---------------------------------------------------------------------------


def _excel_serial_to_iso(value: Any) -> str | None:
    """An Excel day-count as ISO-8601 UTC, or `None` when it is not a serial."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None).isoformat() + "Z"

    text = _text(value)
    if not text:
        return None
    try:
        serial = float(text)
    except ValueError:
        return None
    return (EXCEL_EPOCH + timedelta(days=serial)).isoformat() + "Z"


def parse_sdta_sheet(frame: pd.DataFrame) -> SdtaConfig | None:
    """Shutdown / turnaround windows and the conditions that identify one.

    Returns `None` when the sheet carries neither, so a workbook without an
    SD&TA sheet and one with an empty sheet look the same to the caller.
    """
    ranges: list[SdtaRange] = []
    conditions: list[SdtaCondition] = []

    for row in range(frame.shape[0]):
        first_raw = _raw(frame, row, 0)
        second_raw = _raw(frame, row, 1)
        first = _text(first_raw)
        second = _text(second_raw)
        if not first:
            continue

        condition = CONDITION_RE.match(second)
        if condition and TAG_RE.fullmatch(first):
            conditions.append(
                SdtaCondition(
                    tag=first,
                    op="==" if condition.group(1) == "=" else condition.group(1),
                    value=float(condition.group(2)),
                )
            )
            continue

        start = _excel_serial_to_iso(first_raw)
        end = _excel_serial_to_iso(second_raw)
        if start is not None and end is not None:
            ranges.append(SdtaRange(start=start, end=end))

    if not ranges and not conditions:
        return None
    return SdtaConfig(ranges=tuple(ranges), conditions=tuple(conditions))


def _is_sdta_sheet(name: str) -> bool:
    compact = re.sub(r"[^a-z]", "", name.casefold())
    return compact in {"sdta", "sdandta"}


# ---------------------------------------------------------------------------
# Whole workbook
# ---------------------------------------------------------------------------


def parse_workbook(
    sheets: Mapping[str, pd.DataFrame],
    file_name: str,
    imported_at: str | None = None,
) -> WorkbookParse:
    """Split a workbook into presets, an optional SD&TA config, and the sheets
    that were neither."""
    stamp = imported_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    presets: list[Preset] = []
    skipped: list[str] = []
    sheet_by_unit: dict[str, str] = {}
    sdta: SdtaConfig | None = None

    for name, frame in sheets.items():
        if _is_sdta_sheet(name):
            sdta = parse_sdta_sheet(frame)
            continue

        unit_presets = parse_unit_sheet(name, frame)
        if not unit_presets:
            skipped.append(name)
            continue

        sheet_by_unit[name] = name
        presets.extend(unit_presets)

    return WorkbookParse(
        presets=tuple(presets),
        sdta=sdta,
        skipped_sheets=tuple(skipped),
        file_name=file_name,
        imported_at=stamp,
        sheet_by_unit=sheet_by_unit,
    )


# ---------------------------------------------------------------------------
# Documents (the shapes written to object storage)
# ---------------------------------------------------------------------------

#: Bumped when a stored document changes in a way a reader must know about.
#: 2 (DS-LAKE-020-T02): added `range_parsed`. Nothing in the repo branches on
#: this value; a stored v1 document simply lacks the field, and the client
#: treats its absence as "re-import this preset to enable range cutoffs"
#: rather than re-parsing `range` itself.
SCHEMA_VERSION = 2


def _range_parsed_document(parsed: ParsedRange) -> dict[str, Any]:
    return {
        "kind": parsed.kind,
        "min": parsed.min,
        "max": parsed.max,
        "unit": parsed.unit,
        "raw": parsed.raw,
    }


def _feature_document(feature: PresetFeature) -> dict[str, Any]:
    return {
        "type": feature.type,
        "name": feature.name,
        "formula": feature.formula,
        "description": feature.description,
        "range": feature.range,
        "range_parsed": _range_parsed_document(feature.range_parsed),
        "relation": feature.relation,
        "required_base_tags": list(feature.required_base_tags),
        "parse_warnings": list(feature.parse_warnings),
    }


def preset_document(preset: Preset, parsed: WorkbookParse) -> dict[str, Any]:
    """The JSON written to object storage for one preset. snake_case on the
    wire, like every other payload this service exchanges with NestJS."""
    return {
        "schema_version": SCHEMA_VERSION,
        "preset_id": preset.preset_id,
        "unit": preset.unit,
        "config_no": preset.config_no,
        "name": preset.name,
        "plant": preset.plant,
        "sampling_point": preset.sampling_point,
        "target_y": preset.target_y,
        "features": [_feature_document(feature) for feature in preset.features],
        "required_base_tags": list(preset.required_base_tags),
        "incomplete": preset.incomplete,
        "source": {
            "file_name": parsed.file_name,
            "sheet": parsed.sheet_by_unit.get(preset.unit, preset.unit),
            "imported_at": parsed.imported_at,
        },
    }


def sdta_document(sdta: SdtaConfig, parsed: WorkbookParse) -> dict[str, Any]:
    """The JSON written for the SD&TA cut config."""
    return {
        "schema_version": SCHEMA_VERSION,
        "ranges": [{"from": r.start, "to": r.end} for r in sdta.ranges],
        "conditions": [
            {"tag": c.tag, "op": c.op, "value": c.value} for c in sdta.conditions
        ],
        "source": {
            "file_name": parsed.file_name,
            "imported_at": parsed.imported_at,
        },
    }
