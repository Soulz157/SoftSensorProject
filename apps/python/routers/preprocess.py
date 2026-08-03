"""Preprocessing endpoints: preview, materialize, clean, rows, cleanup.

Error mapping follows the convention in `routers/data.py`: a caller-fixable
problem (unknown column, unsupported operation, missing artifact, empty fetch)
is 422, and anything else is 502 with the traceback printed server-side rather
than leaked in the response body.

NestJS is the only intended caller. It owns authorization, dataset ownership
and job tracking; this service owns the data and holds the only S3 credentials.

Every handler offloads to `asyncio.to_thread`. The work is sync pandas and
whole-object I/O; left on the event loop a single large artifact would stall
every other request in the service, PI fetches included.

`/materialize` receives DECRYPTED source credentials in its body. Nothing here
logs the request, and no error path echoes it — the same rule
`apps/backend/src/lib/python-client.ts` states on the calling side.
"""

import asyncio
import traceback

from fastapi import APIRouter, Depends, HTTPException

from dependencies import get_object_store
from intergrations.object_store import ObjectStore, ObjectStoreError
from schemas.preprocess import (
    ArtifactStatsResponse,
    CleanRequest,
    CleanupRequest,
    CleanupResponse,
    MaterializeRequest,
    PreviewRequest,
    PreviewResponse,
    RowsRequest,
    RowsResponse,
)
from services import artifact_service
from services.cleaning_service import CleaningError
from services.preview_service import build_preview

router = APIRouter(prefix="/v1/preprocess", tags=["Preprocess"])


async def _run(handler, *args):
    """Shared offload + error mapping for every handler in this router.

    One place rather than five copies of the same except-chain: a divergence
    between them would surface as one endpoint answering 502 where its
    neighbours answer 422, which the job runner would then have to special-case.
    """
    try:
        return await asyncio.to_thread(handler, *args)
    except CleaningError as e:
        # Unsupported operation or unknown column — the caller can fix it.
        raise HTTPException(status_code=422, detail=str(e))
    except ObjectStoreError as e:
        # Missing artifact, or storage refused the read/write.
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        # Message deliberately generic. The 422 branches above raise messages
        # this codebase wrote (column names, object keys), but an unexpected
        # exception here can come from the PI or SQL driver, whose text may
        # embed the connection string or credentials from a /materialize body.
        # `python-client.ts` relays upstream detail onward, so anything put
        # here can reach the browser. The traceback goes to the server log.
        traceback.print_exc()
        raise HTTPException(
            status_code=502,
            detail="Preprocessing failed. See the connector service logs.",
        )


@router.post(
    "/preview",
    response_model=PreviewResponse,
    summary="Preview a cleaning pipeline without writing anything",
    description=(
        "Applies the operations to a capped head window of the source artifact "
        "and returns a before/after comparison. Creates no object and no "
        "dataset version. When the artifact is larger than `sample_rows` the "
        "response sets `sampled` and names the operations whose result may "
        "differ once committed."
    ),
)
async def preview_pipeline(
    body: PreviewRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(build_preview, store, body)


@router.post(
    "/materialize",
    response_model=ArtifactStatsResponse,
    summary="Fetch from the source and write the raw (V1) artifact",
    description=(
        "Fetches directly from PI or SQL and writes the canonical frame in one "
        "hop. NestJS supplies decrypted credentials but never sees the rows — "
        "routing millions of rows back through the API server is the ceiling "
        "this pipeline exists to remove. Provide exactly one of `pi` or `sql`."
    ),
)
async def materialize_version(
    body: MaterializeRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.materialize, store, body)


@router.post(
    "/clean",
    response_model=ArtifactStatsResponse,
    summary="Apply cleaning operations from one artifact to another",
    description=(
        "Reads `source_key`, applies the operations, writes `target_key`. The "
        "runner calls this once per operation, chaining keys through "
        "`{datasetId}/tmp/{jobId}/`, so a failure leaves every earlier step "
        "intact. `overwrite` is for tmp intermediates on retry — a committed "
        "version key is immutable and must be written with it False."
    ),
)
async def clean_artifact(
    body: CleanRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.clean, store, body)


@router.post(
    "/rows",
    response_model=RowsResponse,
    summary="Read a page of a committed artifact",
    description=(
        "Paginated hydration for the client. Returns the same wide "
        "`{timestamp, cells}` row shape as the preview, plus the artifact's "
        "total row count so the caller knows when to stop paging."
    ),
)
async def read_rows(
    body: RowsRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.rows, store, body)


@router.post(
    "/cleanup",
    response_model=CleanupResponse,
    summary="Delete every object under a tmp prefix",
    description=(
        "Called by the job runner after a job succeeds or is canceled. It "
        "exists because NestJS deliberately holds no S3 credentials and so "
        "cannot clear its own intermediates. Prefixes outside `tmp/` are "
        "refused: committed dataset versions are immutable."
    ),
)
async def cleanup_prefix(
    body: CleanupRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.cleanup, store, body)
