"""Pins the preset import service and its read path.

No MinIO. `RecordingStore` below duck-types only the two methods this service
touches, and — like the fakes in `test_artifact_service.py` and
`test_preview_service.py` — it is hand-written rather than a `MagicMock`. A mock
answers every attribute, so a service that started deleting objects or writing
frames would still be silently satisfied and this file would stay green.

The contract test at the bottom is the load-bearing one: it validates the REAL
parser output against the pydantic response model, so adding a field to the
parser without adding it to `schemas/presets.py` fails here rather than
silently truncating the equations a preset needs to be applied.
"""

from __future__ import annotations

import io
import json

import pandas as pd
import pytest

from intergrations.object_store import ObjectStoreError
from schemas.presets import PresetDocumentRequest, PresetDocumentResponse
from services.preset_parser import parse_workbook, preset_document
from services.preset_service import PresetImportSpec, import_workbook, read_document
from tests.fixtures.preset_workbook import sheets, workbook_bytes

PREFIX = "feature-presets/ws-test/imp-test/"


class RecordingStore:
    """In-memory stand-in. Records every document written, in order.

    Anything outside the two methods the service is allowed to use falls through
    to `__getattr__` and raises — so a write method added to `ObjectStore` later
    is caught here without anyone remembering to update this class.
    """

    def __init__(self, documents: dict[str, object] | None = None) -> None:
        self.documents: dict[str, object] = dict(documents or {})
        self.writes: list[str] = []

    def put_json(self, key: str, document: object, *, overwrite: bool = True) -> int:
        if not overwrite and key in self.documents:
            raise ObjectStoreError(f"Refusing to overwrite sidecar '{key}'.")
        self.documents[key] = document
        self.writes.append(key)
        return 1

    def get_json(self, key: str):
        if key not in self.documents:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        return self.documents[key]

    def __getattr__(self, name: str):
        raise AssertionError(
            f"preset import called {name!r} on the object store. It may only "
            "put_json and get_json."
        )


def test_the_guard_is_actually_armed():
    """A fake that quietly answers everything proves nothing."""
    with pytest.raises(AssertionError):
        RecordingStore().put_frame


def spec(**overrides) -> PresetImportSpec:
    defaults = {
        "content": workbook_bytes(),
        "file_name": "synthetic.xlsx",
        "key_prefix": PREFIX,
    }
    return PresetImportSpec(**{**defaults, **overrides})


# --------------------------------------------------------------------------
# Prefix validation — NestJS builds this string, but we hold the credentials
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "prefix, reason",
    [
        ("feature-presets/ws-test/imp-test", "no trailing slash"),
        ("datasets/ws-test/imp-test/", "outside the preset root"),
        ("feature-presets/../datasets/", "path traversal"),
        ("", "empty"),
    ],
)
def test_a_prefix_that_could_escape_the_preset_root_is_refused(prefix, reason):
    """Without the trailing slash, workspace `ws-1` writes into `ws-10`."""
    store = RecordingStore()

    with pytest.raises(ValueError):
        import_workbook(store, spec(key_prefix=prefix))

    assert store.writes == [], f"{reason}: nothing may be written"


def test_the_prefix_is_only_ever_appended_to():
    """NestJS owns the key layout. This service must not invent a path of its
    own, or the two sides can disagree about where a preset lives."""
    store = RecordingStore()

    import_workbook(store, spec())

    assert all(key.startswith(PREFIX) for key in store.writes)


# --------------------------------------------------------------------------
# Unreadable input
# --------------------------------------------------------------------------


def test_a_file_that_is_not_a_workbook_is_a_caller_error_not_a_crash():
    store = RecordingStore()

    with pytest.raises(ValueError, match="Could not read"):
        import_workbook(store, spec(content=b"this is not a spreadsheet"))

    assert store.writes == []


def test_the_reader_error_is_not_relayed_to_the_caller():
    """openpyxl and zipfile errors describe internal offsets. They tell an end
    user nothing, and `python-client.ts` relays upstream detail to the browser."""
    store = RecordingStore()

    with pytest.raises(ValueError) as excinfo:
        import_workbook(store, spec(content=b"PK\x03\x04 not really a zip"))

    message = str(excinfo.value)
    assert "synthetic.xlsx" in message
    assert "zip" not in message.lower()
    assert "openpyxl" not in message.lower()


def test_a_workbook_with_no_unit_sheets_is_refused_before_anything_is_written():
    """Otherwise the caller gets a 200 with zero presets and no explanation."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        pd.DataFrame([["Revision", "Author"], ["1.0", "redacted"]]).to_excel(
            writer, sheet_name="META", header=False, index=False
        )

    store = RecordingStore()
    with pytest.raises(ValueError, match="no unit sheets"):
        import_workbook(store, spec(content=buffer.getvalue()))

    assert store.writes == []


# --------------------------------------------------------------------------
# What gets written
# --------------------------------------------------------------------------


@pytest.fixture()
def imported():
    store = RecordingStore()
    return store, import_workbook(store, spec())


def test_one_document_is_written_per_preset(imported):
    store, result = imported

    assert f"{PREFIX}u-101-no1.json" in store.documents
    assert f"{PREFIX}u-101-no2.json" in store.documents
    assert f"{PREFIX}u-202-no1.json" in store.documents
    assert len(result["presets"]) == 3


def test_the_sdta_sheet_is_written_beside_the_presets(imported):
    store, result = imported

    assert f"{PREFIX}sdta.json" in store.documents
    assert result["sdta"]["object_key"] == f"{PREFIX}sdta.json"
    assert result["sdta"]["range_count"] == 2
    assert result["sdta"]["condition_count"] == 3


def test_the_sdta_sheet_is_not_reported_as_skipped(imported):
    """It is recognised and parsed, not ignored. A client rendering
    `skipped_sheets` as "sheets we could not use" must not list it."""
    _, result = imported

    assert result["skipped_sheets"] == ["META"]
    assert "SD&TA" not in result["skipped_sheets"]


def test_the_summary_counts_sheets_and_units_separately(imported):
    """4 sheets in the workbook, 2 of which are units."""
    _, result = imported

    assert result["sheet_count"] == 4
    assert result["unit_count"] == 2


def test_each_summary_carries_what_nestjs_indexes(imported):
    _, result = imported
    first = result["presets"][0]

    assert first["preset_id"] == "u-101-no1"
    assert first["unit"] == "U-101"
    assert first["config_no"] == 1
    assert first["target_y"] == "U101FBP.lab"
    assert first["object_key"] == f"{PREFIX}u-101-no1.json"
    assert first["equation_count"] == 5
    assert first["raw_tag_count"] == 1
    assert first["incomplete"] is False
    assert "WW001Spgr60/60f.Lab" in first["required_base_tags"]


def test_an_incomplete_preset_is_indexed_rather_than_dropped(imported):
    """The engineer wrote the target down. Losing it silently is worse than
    surfacing a preset the UI has to disable."""
    _, result = imported
    empty = next(p for p in result["presets"] if p["preset_id"] == "u-101-no2")

    assert empty["incomplete"] is True
    assert empty["equation_count"] == 0
    assert empty["raw_tag_count"] == 0
    assert empty["target_y"] == "U101IBP.lab"


def test_every_written_document_is_json_serialisable(imported):
    """`put_json` will serialise these. A dataclass or numpy scalar surviving
    into the document would fail at the storage boundary, in production."""
    store, _ = imported

    for document in store.documents.values():
        json.dumps(document)


def test_reading_a_missing_document_is_a_caller_error():
    store = RecordingStore()

    with pytest.raises(ObjectStoreError):
        read_document(store, PresetDocumentRequest(key=f"{PREFIX}nope.json"))


def test_a_document_read_returns_what_was_written(imported):
    store, _ = imported

    document = read_document(store, PresetDocumentRequest(key=f"{PREFIX}u-101-no1.json"))

    assert document["preset_id"] == "u-101-no1"
    assert document["features"][0]["formula"] == (
        "(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)"
    )


# --------------------------------------------------------------------------
# Read-key validation
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "datasets/ds-1/artifacts/a-1/data.parquet",
        "feature-presets/../datasets/ds-1/manifest.json",
        "feature-presets/ws-1/imp-1/preset.parquet",
    ],
)
def test_document_reads_are_confined_to_preset_json(key):
    """The bucket also holds dataset artifacts, which have their own authorized
    read path. This endpoint must not become a general object reader."""
    with pytest.raises(ValueError):
        PresetDocumentRequest(key=key)


# --------------------------------------------------------------------------
# Parser <-> schema contract
# --------------------------------------------------------------------------


def test_the_stored_document_matches_the_response_model():
    """The one test that stops the parser and the wire schema drifting apart.

    `range`/`range_parsed` are asserted by CONTENT, not just presence: both
    default to falsy values (`range: str = ""`, `range_parsed: None`), so a
    parser that stopped emitting either would still satisfy a presence-only
    check. Comparing every feature's `.range`/`.range_parsed` against the
    model's is what actually catches that drift (DS-LAKE-020-T01 gap).
    """
    parsed = parse_workbook(sheets(), "synthetic.xlsx")

    for preset in parsed.presets:
        model = PresetDocumentResponse.model_validate(preset_document(preset, parsed))
        assert model.preset_id == preset.preset_id
        assert len(model.features) == len(preset.features)
        for feature, feature_model in zip(preset.features, model.features):
            assert feature_model.range == feature.range
            assert feature_model.range_parsed is not None
            assert feature_model.range_parsed.kind == feature.range_parsed.kind
            assert feature_model.range_parsed.min == feature.range_parsed.min
            assert feature_model.range_parsed.max == feature.range_parsed.max
            assert feature_model.range_parsed.unit == feature.range_parsed.unit
            assert feature_model.range_parsed.raw == feature.range_parsed.raw


# --------------------------------------------------------------------------
# Routes
#
# Status codes are asserted exactly, not merely "it failed". The NestJS client
# maps upstream 4xx to 400 and everything else to 502, so a route answering 502
# where it should answer 422 turns a fixable user error into an outage-shaped
# one. This is the same reason `test_preview_service.py` pins 422-not-502.
# --------------------------------------------------------------------------

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from dependencies import get_object_store
    from main import app

    store = RecordingStore()
    app.dependency_overrides[get_object_store] = lambda: store
    try:
        yield TestClient(app), store
    finally:
        app.dependency_overrides.pop(get_object_store, None)


def upload(client, **overrides):
    payload = {
        "files": {
            "file": ("synthetic.xlsx", workbook_bytes(), XLSX_MIME),
        },
        "data": {"key_prefix": PREFIX},
    }
    payload.update(overrides)
    return client.post("/v1/presets/import", **payload)


def test_importing_a_workbook_returns_the_preset_metadata(client):
    http, store = client

    response = upload(http)

    assert response.status_code == 200
    body = response.json()
    assert [p["preset_id"] for p in body["presets"]] == [
        "u-101-no1",
        "u-101-no2",
        "u-202-no1",
    ]
    assert body["sdta"]["range_count"] == 2
    assert body["skipped_sheets"] == ["META"]
    assert len(store.writes) == 4  # three presets plus sdta.json


def test_a_non_excel_filename_is_rejected_before_it_is_read(client):
    http, store = client

    response = upload(
        http, files={"file": ("notes.csv", b"a,b\n1,2\n", "text/csv")}
    )

    assert response.status_code == 422
    assert store.writes == []


def test_an_empty_upload_is_rejected(client):
    http, store = client

    response = upload(http, files={"file": ("synthetic.xlsx", b"", XLSX_MIME)})

    assert response.status_code == 422
    assert store.writes == []


def test_a_bad_prefix_is_422_not_502(client):
    http, store = client

    response = upload(http, data={"key_prefix": "datasets/ws-1/"})

    assert response.status_code == 422
    assert store.writes == []


def test_a_missing_prefix_is_a_validation_error(client):
    http, _ = client

    response = http.post(
        "/v1/presets/import",
        files={"file": ("synthetic.xlsx", workbook_bytes(), XLSX_MIME)},
    )

    assert response.status_code == 422


def test_a_corrupt_workbook_is_422_not_502(client):
    """The distinction matters: 502 tells the user to call an engineer, 422
    tells them to upload the right file."""
    http, store = client

    response = upload(
        http, files={"file": ("synthetic.xlsx", b"not a workbook", XLSX_MIME)}
    )

    assert response.status_code == 422
    assert store.writes == []


def test_the_document_route_returns_a_stored_preset(client):
    http, _ = client
    upload(http)

    response = http.post(
        "/v1/presets/document", json={"key": f"{PREFIX}u-101-no1.json"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["target_y"] == "U101FBP.lab"
    assert body["features"][0]["name"] == "Spgr_in_feed_Header_1"


def test_the_document_route_refuses_a_key_outside_the_preset_root(client):
    http, _ = client

    response = http.post(
        "/v1/presets/document",
        json={"key": "datasets/ds-1/artifacts/a-1/manifest.json"},
    )

    assert response.status_code == 422


def test_reading_an_unknown_document_is_422_not_502(client):
    http, _ = client

    response = http.post(
        "/v1/presets/document", json={"key": f"{PREFIX}missing.json"}
    )

    assert response.status_code == 422


# --------------------------------------------------------------------------
# SD&TA document route — a SEPARATE response model from /document, because
# sdta.json has no preset_id/unit/target_y/features and validating it against
# PresetDocumentResponse fails every required field that schema has.
# --------------------------------------------------------------------------


def test_the_sdta_document_route_returns_the_stored_cut_config(client):
    http, _ = client
    upload(http)

    response = http.post(
        "/v1/presets/sdta-document", json={"key": f"{PREFIX}sdta.json"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ranges"] == [
        {"from": "2022-09-01T00:00:00Z", "to": "2023-01-01T00:00:00Z"},
        {"from": "2023-11-01T00:00:00Z", "to": "2024-03-01T00:00:00Z"},
    ]
    assert body["conditions"] == [
        {"tag": "GG203.PV", "op": "<", "value": 1700.0},
        {"tag": "YY107.CPV", "op": "<", "value": 100.0},
        {"tag": "TT202.PV", "op": "<", "value": 100.0},
    ]


def test_the_sdta_document_route_refuses_a_key_outside_the_preset_root(client):
    http, _ = client

    response = http.post(
        "/v1/presets/sdta-document",
        json={"key": "datasets/ds-1/artifacts/a-1/manifest.json"},
    )

    assert response.status_code == 422


def test_reading_an_unknown_sdta_document_is_422_not_502(client):
    http, _ = client

    response = http.post(
        "/v1/presets/sdta-document", json={"key": f"{PREFIX}missing.json"}
    )

    assert response.status_code == 422
