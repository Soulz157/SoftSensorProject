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
    ArtifactReclaimRequest,
    ArtifactReclaimResponse,
    ArtifactStatsResponse,
    CleanRequest,
    CleanupRequest,
    CleanupResponse,
    ColumnStatsRequest,
    ColumnStatsResponse,
    FeaturesRequest,
    MaterializeRequest,
    MetadataRequest,
    MetadataResponse,
    PreviewRequest,
    PreviewResponse,
    RowsRequest,
    RowsResponse,
    TagCatalogRequest,
    TagCatalogResponse,
    ValidateRequest,
    ValidationReportResponse,
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
    except NotImplementedError as e:
        # DS-LAKE-006-T05: a `formula`-kind feature — a real, named,
        # not-yet-supported request shape, not an unexpected server fault.
        # No current route relies on this propagating as 502 instead
        # (`apply_fixture_case`, the only other NotImplementedError raiser,
        # is test-only and never reaches this router).
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
    "/features",
    response_model=ArtifactStatsResponse,
    summary="Apply feature engineering, column selection and scaling",
    description=(
        "Reads `source_key` (the SILVER artifact), writes `target_key` (the "
        "GOLD artifact) — applyFeatures, then selectColumns, then "
        "toModelReady, in that fixed order. Writes feature_spec.json beside "
        "the data; `feature_spec_key` in the response is what NestJS "
        "persists as DatasetArtifact.featureSpecKey. `formula`-kind features "
        "are not supported yet (see feature_service.py's module docstring) "
        "and fail this request with 422."
    ),
)
async def create_features(
    body: FeaturesRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.features, store, body)


@router.post(
    "/validate",
    response_model=ValidationReportResponse,
    summary="Run the validation gate against a committed artifact",
    description=(
        "Read-only against the artifact — writes no data object, mutates no "
        "frame. The one write is validation_report.json, a sidecar beside "
        "the data (same as column_stats.json/feature_spec.json). Returns "
        "PASS/FAIL with a per-check breakdown naming which check failed "
        "and by how much."
    ),
)
async def validate_artifact(
    body: ValidateRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.validate, store, body)


@router.post(
    "/rows",
    response_model=RowsResponse,
    summary="Read a page of a committed artifact",
    description=(
        "Paginated hydration for the client. Returns the same wide "
        "`{timestamp, cells}` row shape as the preview, plus the artifact's "
        "total row count so the caller knows when to stop paging. "
        "`format: 'arrow'` (DS-LAKE-005B-A-T05) returns the same page as an "
        "Arrow IPC stream instead, with the envelope carried in response "
        "headers (X-Total-Row-Count, X-Offset, X-Filtered, X-Start-Time, "
        "X-End-Time) rather than the JSON body. `response_model` above only "
        "applies to the default `format: 'json'` — FastAPI skips it "
        "automatically when the handler returns a `Response` directly."
    ),
)
async def read_rows(
    body: RowsRequest,
    store: ObjectStore = Depends(get_object_store),
):
    # Both branches stay inside `_run` so an unknown tag maps to 422 on
    # EITHER format, not just the JSON one — the same except-chain every
    # other handler in this router relies on.
    if body.format == "arrow":
        return await _run(artifact_service.rows_arrow, store, body)
    return await _run(artifact_service.rows, store, body)


@router.post(
    "/metadata",
    response_model=MetadataResponse,
    summary="Tag list and timestamp range of a committed artifact",
    description=(
        "Reads only the Parquet footer and the `timestamp` column — never the "
        "tag or status columns. Row count, column count, tag count, missingPct, "
        "checksum and createdAt already live on the DatasetArtifact row, so "
        "NestJS serves those without calling this endpoint at all "
        "(DS-LAKE-005B-A-T01)."
    ),
)
async def read_metadata(
    body: MetadataRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.metadata, store, body)


@router.post(
    "/tags",
    response_model=TagCatalogResponse,
    summary="Paginated, searchable tag names for a committed artifact",
    description=(
        "Reads only the Parquet footer, via the same call `/metadata` uses — "
        "never a tag or status column. Browsing 8,000+ tags this way costs "
        "one object download regardless of how many pages the client turns "
        "(DS-LAKE-005B-A-T03)."
    ),
)
async def read_tag_catalog(
    body: TagCatalogRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.tag_catalog, store, body)


@router.post(
    "/column-stats",
    response_model=ColumnStatsResponse,
    summary="Per-tag aggregate stats sidecar for a committed artifact",
    description=(
        "Reads ONLY column_stats.json, written beside the data at write time "
        "— data.parquet is never opened, so serving stats for 8,000 tags "
        "costs exactly the same one object download as one tag "
        "(DS-LAKE-005B-A-T07). A missing sidecar (a legacy artifact written "
        "before this task) is a 422, not a fallback compute-on-read — that "
        "would open data.parquet and defeat the point of the sidecar."
    ),
)
async def read_column_stats(
    body: ColumnStatsRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.column_stats, store, body)


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


@router.post(
    "/artifacts/reclaim",
    response_model=ArtifactReclaimResponse,
    summary="Delete one committed artifact's stored objects",
    description=(
        "DS-LAKE-009B. Called by ArtifactCleanupService once Postgres has "
        "proven the artifact eligible — not reachable through any "
        "non-ARCHIVED DatasetVersion's lineage, and past its retention "
        "window. Deletes data.parquet and every sidecar beside it. "
        "Idempotent: a retried call on an already-reclaimed artifact "
        "returns deleted: 0 rather than failing. The opposite guard from "
        "/cleanup — this endpoint refuses anything that is NOT a committed "
        "artifact key, so it cannot be pointed at tmp/ or a preset."
    ),
)
async def reclaim_artifact(
    body: ArtifactReclaimRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.reclaim_artifact, store, body)
