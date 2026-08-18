"""Import a soft-sensor workbook into object storage, and read one back.

The split against `preset_parser` is deliberate: the parser is pure and knows
nothing about storage, this module does all the I/O and none of the parsing.

Division of labour with NestJS, same as `artifact_service`:

* NestJS owns authorization, workspace ownership, and the Postgres index. It
  also chooses WHERE objects go — it passes `key_prefix` and this module only
  appends filenames to it, so the key layout stays owned by one side.
* This service owns the objects and holds the only S3 credentials, which is why
  `read_document` exists at all: NestJS cannot fetch what it told us to write.

Everything here is synchronous. The router offloads it via `asyncio.to_thread`
because `pd.read_excel` is CPU-bound and would otherwise stall the event loop.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass
from typing import Any

import pandas as pd

from intergrations.object_store import (
    PRESET_ROOT,
    ObjectStore,
    preset_key,
    sdta_key,
)
from schemas.presets import PresetDocumentRequest
from services.preset_parser import (
    Preset,
    WorkbookParse,
    parse_workbook,
    preset_document,
    sdta_document,
)


@dataclass(frozen=True)
class PresetImportSpec:
    """One upload. Not a pydantic body — the route receives multipart, so the
    file arrives as bytes and `key_prefix` as a form field."""

    content: bytes
    file_name: str
    key_prefix: str


def assert_preset_prefix(prefix: str) -> None:
    """Refuse a prefix that could write outside the preset root.

    Mirrors `CleanupRequest.prefix_is_a_directory`: a bare prefix with no
    trailing slash lets one workspace id that is a string prefix of another
    ("ws-1" vs "ws-10") write into its neighbour, and `..` would escape the root
    entirely. NestJS builds this string, but this service is the one holding the
    credentials, so it does not take that on trust.
    """
    if not prefix.startswith(PRESET_ROOT):
        raise ValueError(f"key_prefix must start with '{PRESET_ROOT}'.")
    if not prefix.endswith("/"):
        raise ValueError(
            "key_prefix must end with '/' so it cannot match a sibling prefix."
        )
    if ".." in prefix:
        raise ValueError("key_prefix must not contain '..'.")


def _read_sheets(content: bytes, file_name: str) -> dict[str, pd.DataFrame]:
    """Every sheet as a `header=None` frame.

    `header=None` matters: these sheets carry title and sampling-point rows
    above the real header, so letting pandas infer one would consume the plant
    name as column labels and shift every row.

    A parse failure is the caller's problem (wrong file, corrupt upload), so it
    becomes a ValueError -> 422. The underlying message is not relayed: openpyxl
    and zipfile errors describe internal offsets, which tell an end user nothing
    and tell an attacker a little.
    """
    try:
        return pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    except Exception as err:  # noqa: BLE001 - any reader failure is caller-fixable
        raise ValueError(
            f"Could not read '{file_name}' as an Excel workbook. Upload the "
            "original .xlsx template."
        ) from err


def _summary(preset: Preset, key: str) -> dict[str, Any]:
    return {
        "preset_id": preset.preset_id,
        "unit": preset.unit,
        "config_no": preset.config_no,
        "name": preset.name,
        "sampling_point": preset.sampling_point,
        "target_y": preset.target_y,
        "object_key": key,
        "equation_count": sum(1 for f in preset.features if f.type == "equation"),
        "raw_tag_count": sum(1 for f in preset.features if f.type == "raw_tag"),
        "required_base_tags": list(preset.required_base_tags),
        "incomplete": preset.incomplete,
    }


def _assert_ids_are_unique(parsed: WorkbookParse) -> None:
    """Two sheets whose names slug to the same id would overwrite each other's
    object — `S-204` and `S 204` both slug to `s-204`. Silent data loss, so it
    is refused rather than resolved."""
    seen: set[str] = set()
    for preset in parsed.presets:
        if preset.preset_id in seen:
            raise ValueError(
                f"Two sheets produced the same preset id '{preset.preset_id}'. "
                "Rename one of the sheets so they are distinguishable."
            )
        seen.add(preset.preset_id)


def import_workbook(store: ObjectStore, spec: PresetImportSpec) -> dict[str, Any]:
    """Parse a workbook, write one document per preset, return the metadata.

    Objects are written before the response is built, and a failure part-way
    leaves the documents already written in place. That is safe because NestJS
    only records what this call RETURNS: an orphaned object under a failed
    import's prefix is unreferenced, whereas a Postgres row pointing at an
    object that was never written would be a broken preset in the picker.
    """
    started = time.perf_counter()
    assert_preset_prefix(spec.key_prefix)

    sheets = _read_sheets(spec.content, spec.file_name)
    parsed = parse_workbook(sheets, spec.file_name)

    if not parsed.presets:
        raise ValueError(
            f"'{spec.file_name}' has no unit sheets. A unit sheet needs a header "
            "row with 'No', 'Y' and 'X' columns."
        )
    _assert_ids_are_unique(parsed)

    summaries: list[dict[str, Any]] = []
    for preset in parsed.presets:
        key = preset_key(spec.key_prefix, preset.preset_id)
        store.put_json(key, preset_document(preset, parsed))
        summaries.append(_summary(preset, key))

    sdta: dict[str, Any] | None = None
    if parsed.sdta is not None:
        key = sdta_key(spec.key_prefix)
        store.put_json(key, sdta_document(parsed.sdta, parsed))
        sdta = {
            "object_key": key,
            "range_count": len(parsed.sdta.ranges),
            "condition_count": len(parsed.sdta.conditions),
        }

    return {
        "file_name": spec.file_name,
        "key_prefix": spec.key_prefix,
        "imported_at": parsed.imported_at,
        "sheet_count": len(sheets),
        "unit_count": len({p.unit for p in parsed.presets}),
        "presets": summaries,
        "skipped_sheets": list(parsed.skipped_sheets),
        "sdta": sdta,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }


def read_document(store: ObjectStore, request: PresetDocumentRequest) -> Any:
    """One stored preset document, verbatim."""
    return store.get_json(request.key)
