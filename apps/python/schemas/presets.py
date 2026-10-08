"""Request/response contracts for the feature-preset endpoints.

snake_case on the wire, like `schemas/preprocess.py` — NestJS maps to its
camelCase DTOs on its side.

Two shapes live here and they are not the same thing:

* `PresetSummary` is what NestJS persists to Postgres so the client can list
  presets without reading object storage. It is metadata only.
* `PresetDocumentResponse` is the FULL document stored in MinIO, returned by
  `/document` when the client actually applies a preset. It mirrors
  `services.preset_parser.preset_document` field for field, and
  `tests/test_preset_service.py` validates the parser's real output against it —
  so adding a field to the parser without adding it here fails a test rather
  than silently truncating the equations a preset needs.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from intergrations.object_store import PRESET_ROOT


class PresetSummary(BaseModel):
    """One preset, as NestJS indexes it. No equations — those live in the
    document, and duplicating them into Postgres would create a second source of
    truth that can drift from the object."""

    preset_id: str = Field(..., examples=["s-204-no1"])
    #: Sheet name. One process unit per sheet.
    unit: str = Field(..., examples=["S-204"])
    config_no: int = Field(..., examples=[1])
    name: str = Field(..., examples=["S-204 No.1 — S204FBP.lab"])
    sampling_point: str = Field("", examples=["RS-204 Reflux"])
    #: The lab measurement this preset predicts.
    target_y: str = Field(..., examples=["S204FBP.lab"])
    object_key: str = Field(..., examples=["feature-presets/ws-1/imp-1/s-204-no1.json"])
    equation_count: int = 0
    raw_tag_count: int = 0
    #: Deduped union across every feature. The client compares this against the
    #: dataset's tags to decide whether the preset can be applied at all.
    required_base_tags: list[str] = Field(default_factory=list)
    #: True when the sheet declared a target but listed no X rows. Four of the
    #: nine presets in the reference workbook are like this, so the UI must be
    #: able to show them as unusable rather than pretend they do not exist.
    incomplete: bool = False


class SdtaSummary(BaseModel):
    """What was found on the SD&TA sheet, if there was one."""

    object_key: str = Field(..., examples=["feature-presets/ws-1/imp-1/sdta.json"])
    range_count: int = 0
    condition_count: int = 0


class ImportPresetsResponse(BaseModel):
    """The summary NestJS turns into one import row plus N preset rows."""

    file_name: str = Field(..., examples=["soft-sensor-templates.xlsx"])
    key_prefix: str = Field(..., examples=["feature-presets/ws-1/imp-1/"])
    imported_at: str = Field(..., examples=["2026-08-05T00:00:00Z"])
    #: Every sheet in the workbook, including the ones that produced nothing.
    sheet_count: int = 0
    #: Sheets that yielded at least one preset.
    unit_count: int = 0
    presets: list[PresetSummary] = Field(default_factory=list)
    #: Sheets with no `No | Y | X` header. NOTE: an SD&TA sheet is NOT reported
    #: here — it is recognised and parsed into `sdta`, not skipped. A client that
    #: renders this list as "sheets we ignored" must not imply otherwise.
    skipped_sheets: list[str] = Field(default_factory=list)
    sdta: Optional[SdtaSummary] = None


class PresetDocumentRequest(BaseModel):
    """Read one stored document back.

    Exists because NestJS deliberately holds no S3 credentials, so it cannot
    fetch the equations it told this service to write.
    """

    key: str = Field(..., examples=["feature-presets/ws-1/imp-1/s-204-no1.json"])

    @model_validator(mode="after")
    def key_is_a_preset_document(self) -> "PresetDocumentRequest":
        # Confining reads to the preset root keeps this endpoint from becoming a
        # general "read any object" primitive — the bucket also holds dataset
        # artifacts, which have their own authorized read path.
        if not self.key.startswith(PRESET_ROOT):
            raise ValueError(f"key must start with '{PRESET_ROOT}'.")
        if not self.key.endswith(".json"):
            raise ValueError("key must name a .json document.")
        if ".." in self.key:
            raise ValueError("key must not contain '..'.")
        return self


class ParsedRangeDocument(BaseModel):
    """`range` resolved to a numeric bound. Absent on a schema_version 1
    document (predates DS-LAKE-020-T02)."""

    kind: Literal["none", "closed", "lower", "upper"] = "none"
    min: Optional[float] = None
    max: Optional[float] = None
    unit: Optional[str] = None
    raw: str = ""


class PresetFeatureDocument(BaseModel):
    """One X row of a stored preset."""

    type: Literal["equation", "raw_tag"]
    #: For an equation, the sanitised column name the engineered feature takes.
    #: For a raw tag, the tag itself, verbatim.
    name: str
    #: The original expression. Null for a raw tag.
    formula: Optional[str] = None
    description: str = ""
    range: str = ""
    #: Absent on a pre-T02 (schema_version 1) document.
    range_parsed: Optional[ParsedRangeDocument] = None
    relation: str = ""
    required_base_tags: list[str] = Field(default_factory=list)
    #: Ambiguities a human should confirm — a tag whose own name contains a
    #: slash (indistinguishable from division in text), or a `range` cell
    #: that looked like an attempted bound but could not be parsed.
    parse_warnings: list[str] = Field(default_factory=list)


class PresetSourceDocument(BaseModel):
    file_name: str
    sheet: str
    imported_at: str


class PresetDocumentResponse(BaseModel):
    """The full stored preset. Mirrors `preset_parser.preset_document`."""

    schema_version: int
    preset_id: str
    unit: str
    config_no: int
    name: str
    plant: str = ""
    sampling_point: str = ""
    target_y: str
    features: list[PresetFeatureDocument] = Field(default_factory=list)
    required_base_tags: list[str] = Field(default_factory=list)
    incomplete: bool = False
    source: PresetSourceDocument


class SdtaRangeDocument(BaseModel):
    """One shutdown/turnaround window. ISO-8601 UTC — already converted from
    an Excel serial server-side; never a raw day-count."""

    from_: str = Field(..., alias="from")
    to: str

    model_config = {"populate_by_name": True}


class SdtaConditionDocument(BaseModel):
    tag: str
    op: str
    value: float


class SdtaSourceDocument(BaseModel):
    """No `sheet`: unlike a preset, SD&TA is not scoped to one unit sheet."""

    file_name: str
    imported_at: str


class SdtaDocumentResponse(BaseModel):
    """The stored SD&TA cut config. Mirrors `preset_parser.sdta_document`.

    Deliberately its OWN shape rather than reusing `PresetDocumentResponse`:
    this document has no `preset_id`/`unit`/`target_y`/`features` — validating
    it against the preset schema fails every field that schema requires.
    """

    schema_version: int
    ranges: list[SdtaRangeDocument] = Field(default_factory=list)
    conditions: list[SdtaConditionDocument] = Field(default_factory=list)
    source: SdtaSourceDocument
