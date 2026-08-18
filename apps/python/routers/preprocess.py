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
import logging
import resource
import sys
import time
import traceback

from fastapi import APIRouter, Depends, HTTPException

from dependencies import get_object_store
from intergrations.object_store import ObjectStore, ObjectStoreError
from schemas.preprocess import (
    ArtifactReclaimRequest,
    ArtifactReclaimResponse,
    ArtifactStatsResponse,
    ArtifactPresignRequest,
    ArtifactPresignResponse,
    BoxplotRequest,
    BoxplotResponse,
    ModelRunUploadPresignRequest,
    ModelRunUploadPresignResponse,
    CleanRequest,
    CleanupRequest,
    CleanupResponse,
    ColumnStatsRequest,
    ColumnStatsResponse,
    FeaturesRequest,
    HistogramRequest,
    HistogramResponse,
    MaterializeRequest,
    MetadataRequest,
    MetadataResponse,
    PreviewRequest,
    PreviewResponse,
    CorrelationRequest,
    CorrelationResponse,
    RowsRequest,
    RowsResponse,
    ScatterRequest,
    ScatterResponse,
    TagCatalogRequest,
    TagCatalogResponse,
    ValidateRequest,
    ValidationReportResponse,
)
from services import artifact_service
from services.boxplot_service import build_boxplot
from services.cleaning_service import CleaningError
from services.correlation_matrix_service import build_correlation_matrix
from services.histogram_service import build_histogram
from services.preview_service import build_preview
from services.scatter_service import build_scatter

router = APIRouter(prefix="/v1/preprocess", tags=["Preprocess"])

logger = logging.getLogger(__name__)


def _peak_rss_kb() -> int:
    """`resource.getrusage(...).ru_maxrss` — peak resident set size for the
    WHOLE PROCESS since it started, not a per-request delta (the kernel
    gives no cheaper per-call figure without external tooling, and this is
    the "how big did this process get" observability signal DS-LAKE-005B-C
    -T07 asks for, not a per-request allocation profile). Units are
    PLATFORM-DEPENDENT and a real, documented POSIX quirk: Linux reports
    KB, macOS (Darwin) reports BYTES — normalised to KB here so dev (macOS)
    and prod (Linux container) logs are directly comparable, not silently
    off by 1024x from each other.
    """
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return raw // 1024 if sys.platform == "darwin" else raw


async def _run(handler, *args):
    """Shared offload + error mapping for every handler in this router.

    One place rather than five copies of the same except-chain: a divergence
    between them would surface as one endpoint answering 502 where its
    neighbours answer 422, which the job runner would then have to special-case.

    DS-LAKE-005B-C-T07 (large-dataset observability, server-side slice):
    every handler in this router funnels through here, so this is the one
    place to log API latency + Python CPU time consumed by the request +
    the process's peak memory, without touching any of the ~14 individual
    handlers. `ru_utime`/`ru_stime` are CUMULATIVE PROCESS counters (same
    platform-independence as `ru_maxrss` above, no macOS/Linux unit quirk
    on these two fields) — the BEFORE/AFTER delta isolates what THIS
    request's `asyncio.to_thread` call actually burned, not the process
    total. Logged in `finally` so a failed request is measured too — a
    slow failure is exactly the kind of thing this exists to catch.
    """
    started = time.perf_counter()
    cpu_before = resource.getrusage(resource.RUSAGE_SELF)
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
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        cpu_after = resource.getrusage(resource.RUSAGE_SELF)
        cpu_ms = (
            (cpu_after.ru_utime + cpu_after.ru_stime)
            - (cpu_before.ru_utime + cpu_before.ru_stime)
        ) * 1000
        logger.info(
            "preprocess_request handler=%s elapsed_ms=%.1f cpu_ms=%.1f peak_rss_kb=%d",
            getattr(handler, "__name__", repr(handler)),
            elapsed_ms,
            cpu_ms,
            _peak_rss_kb(),
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
    "/histogram",
    response_model=HistogramResponse,
    summary="Histogram/KDE for one or more tags, recomputed under live operations",
    description=(
        "DS-LAKE-005B-D-T01. Same window-then-apply-operations shape as "
        "/preview — reads a capped head window, applies the operations, and "
        "returns bug-for-bug parity with the client's own tagDistribution/"
        "kdeEstimate/densityToCount (lib/data-quality.ts). Writes nothing. "
        "`tags` is REQUIRED (unlike /preview) — the domain is shared across "
        "every overlaid tag, so 'every tag' is never a sane default here."
    ),
)
async def histogram_pipeline(
    body: HistogramRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(build_histogram, store, body)


@router.post(
    "/boxplot",
    response_model=BoxplotResponse,
    summary="Five-number summary + capped outlier list per tag, recomputed under live operations",
    description=(
        "DS-LAKE-005B-D-T03. Same window-then-apply-operations shape as "
        "/histogram — reads a capped head window, applies the operations, "
        "and returns bug-for-bug parity with the client's own "
        "tagBoxplotStats (lib/data-quality.ts). Writes nothing. `tags` is "
        "REQUIRED (unlike /preview) — a box plot with no tags named is "
        "never a sane default. The outlier list is capped by `outlier_cap`; "
        "`outlier_count` on each tag always carries the true, uncapped total."
    ),
)
async def boxplot_pipeline(
    body: BoxplotRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(build_boxplot, store, body)


@router.post(
    "/scatter",
    response_model=ScatterResponse,
    summary="Decimated scatter cloud + full-frame regression for two tags",
    description=(
        "DS-LAKE-005B-D-T04. Same window-then-apply-operations shape as "
        "/histogram and /boxplot — reads a capped head window, applies the "
        "operations, and returns bug-for-bug parity with the client's own "
        "linearRegression (lib/preprocessing.ts) for the coefficients. "
        "Writes nothing. `points` is decimated via 2D grid binning for "
        "plotting only (NOT the /preview LTTB path — a scatter's axes are "
        "tag values, not time); the regression is always fit over the FULL "
        "Good-filtered frame and `n` states the true count, never the "
        "decimated one. A pair counts only when BOTH x and y are Good — a "
        "deliberate, tracked divergence from the client's status-blind "
        "toScatterPoints, which this endpoint does not port."
    ),
)
async def scatter_pipeline(
    body: ScatterRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(build_scatter, store, body)


@router.post(
    "/correlation",
    response_model=CorrelationResponse,
    summary="Pearson correlation matrix over a server-resolved column list, hard-capped",
    description=(
        "DS-LAKE-005B-D-T05b. Same window-then-apply-operations shape as "
        "/histogram, /boxplot and /scatter. `tags` is the CANDIDATE "
        "universe; the server resolves it (DS-LAKE-005B-D-T05a: near-"
        "constant filter, then rank by IQR/median or CV) down to at most "
        "`top_k` columns before computing the matrix — 8,000 candidate "
        "tags is never 64M matrix cells. The response ECHOES the resolved "
        "list, since a server-side auto-pick means the client cannot "
        "infer which columns it got."
    ),
)
async def correlation_pipeline(
    body: CorrelationRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(build_correlation_matrix, store, body)


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


@router.post(
    "/artifacts/presign",
    response_model=ArtifactPresignResponse,
    summary="Time-limited read URLs for one committed artifact",
    description=(
        "Mints presigned GET URLs so a training container can read "
        "data.parquet and its sidecars WITHOUT holding S3 credentials — the "
        "same boundary /materialize keeps for source credentials, in the "
        "opposite direction. Same guard as /artifacts/reclaim: anything that "
        "is not a committed artifact data key is refused, so this cannot be "
        "pointed at tmp/ or a preset. Returns the artifact's checksum "
        "alongside, so the holder can verify the bytes it downloaded rather "
        "than trusting them. URLs are short-lived on purpose (15 min) — the "
        "container is expected to download to local disk before training, "
        "not to stream from object storage for the length of a fit."
    ),
)
async def presign_artifact(
    body: ArtifactPresignRequest,
    store: ObjectStore = Depends(get_object_store),
):
    print(
        f"Presign request for artifact {body}")
    return await _run(artifact_service.presign_artifact, store, body)


@router.post(
    "/models/runs/presign-upload",
    response_model=ModelRunUploadPresignResponse,
    summary="Time-limited write URLs for one training run's outputs",
    description=(
        "The write half of /artifacts/presign. Refuses any key outside "
        "models/{modelId}/runs/{runId}/, so a run cannot be talked into "
        "overwriting a dataset artifact — which put_frame's immutability "
        "refusal cannot protect here, because the write happens in another "
        "process. Called at the END of a run rather than at submit: a URL "
        "minted up front would have to outlive the whole fit, turning a "
        "30-minute capability into a multi-hour one for no gain."
    ),
)
async def presign_model_run_upload(
    body: ModelRunUploadPresignRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.presign_model_run_upload, store, body)
