"""Feature-preset endpoints: import a workbook, read a stored document.

Error mapping follows `routers/preprocess.py`: a caller-fixable problem (wrong
file type, malformed prefix, a workbook with no unit sheets, a missing object)
is 422, and anything else is 502 with the traceback printed server-side rather
than leaked in the response body.

NestJS is the only intended caller. It owns authorization, workspace ownership
and the Postgres index; this service owns the objects and holds the only S3
credentials — which is why `/document` exists, since NestJS cannot read back
what it asked us to write.

`/import` is the one multipart endpoint in this service. The upload is read
fully into memory: NestJS caps it at 5 MB and the reference workbook is 33 KB,
so streaming would be new plumbing for no gain at this size.
"""

import asyncio
import traceback

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from dependencies import get_object_store
from intergrations.object_store import ObjectStore, ObjectStoreError
from schemas.presets import (
    ImportPresetsResponse,
    PresetDocumentRequest,
    PresetDocumentResponse,
    SdtaDocumentResponse,
)
from services import preset_service
from services.preset_service import PresetImportSpec

router = APIRouter(prefix="/v1/presets", tags=["Presets"])

#: Browsers and curl disagree about what an .xlsx is, and some clients send
#: nothing useful at all — so the extension is what decides, and the content
#: type is not trusted. The real check is whether pandas can open it.
_ALLOWED_SUFFIXES = (".xlsx", ".xlsm")


async def _run(handler, *args):
    """Shared offload + error mapping, mirroring `routers/preprocess.py:_run`.

    Kept identical on purpose: a divergence would show up as this router
    answering 502 where its neighbour answers 422, which the NestJS client
    would then have to special-case per endpoint.
    """
    try:
        return await asyncio.to_thread(handler, *args)
    except ObjectStoreError as e:
        # Missing document, or storage refused the read/write.
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        # Bad prefix, unreadable workbook, no unit sheets, duplicate preset id.
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        # Generic on purpose. The 422 branches above raise messages this
        # codebase wrote; an unexpected exception here can carry text from
        # openpyxl or the S3 driver, and `python-client.ts` relays upstream
        # detail onward to the browser. The traceback goes to the server log.
        traceback.print_exc()
        raise HTTPException(
            status_code=502,
            detail="Preset import failed. See the connector service logs.",
        )


@router.post(
    "/import",
    response_model=ImportPresetsResponse,
    summary="Parse a soft-sensor workbook and store one JSON preset per config",
    description=(
        "Splits the workbook into one document per unit sheet and `No.` block, "
        "writes each under `key_prefix`, and returns the metadata NestJS "
        "indexes in Postgres. `key_prefix` is supplied by the caller and only "
        "ever appended to, so the key layout stays owned by NestJS. A sheet "
        "with no `No | Y | X` header is reported in `skipped_sheets`; an SD&TA "
        "sheet is parsed into `sdta` instead and is NOT listed as skipped."
    ),
)
async def import_presets(
    file: UploadFile = File(..., description="The .xlsx template."),
    key_prefix: str = Form(
        ...,
        description="Must start with 'feature-presets/' and end with '/'.",
        examples=["feature-presets/ws-1/imp-1/"],
    ),
    store: ObjectStore = Depends(get_object_store),
):
    file_name = file.filename or "workbook.xlsx"
    if not file_name.lower().endswith(_ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=422,
            detail="Upload an Excel workbook (.xlsx or .xlsm).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")

    spec = PresetImportSpec(content=content, file_name=file_name, key_prefix=key_prefix)
    return await _run(preset_service.import_workbook, store, spec)


@router.post(
    "/document",
    response_model=PresetDocumentResponse,
    summary="Read one stored preset document",
    description=(
        "Returns the full preset — target, features, equations and required "
        "base tags. Reads are confined to the `feature-presets/` root so this "
        "does not become a general object-read primitive over a bucket that "
        "also holds dataset artifacts."
    ),
)
async def read_preset_document(
    body: PresetDocumentRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(preset_service.read_document, store, body)


@router.post(
    "/sdta-document",
    response_model=SdtaDocumentResponse,
    summary="Read one stored SD&TA cut config",
    description=(
        "Returns the shutdown/turnaround windows and cut conditions parsed "
        "from the workbook's SD&TA sheet. A SEPARATE response model from "
        "`/document`: this object has no preset_id/unit/target_y/features, so "
        "validating it against PresetDocumentResponse fails every required "
        "field that schema has. Same key-confined read, same underlying "
        "`preset_service.read_document` — only the response shape differs."
    ),
)
async def read_sdta_document(
    body: PresetDocumentRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(preset_service.read_document, store, body)
