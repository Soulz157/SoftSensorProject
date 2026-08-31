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
from intergrations.object_store import (
    ObjectNotFoundError,
    ObjectStore,
    ObjectStoreError,
)
from schemas.preprocess import (
    ArtifactAdoptRequest,
    ArtifactAdoptResponse,
    ArtifactReclaimRequest,
    ArtifactReclaimResponse,
    ArtifactStatsResponse,
    DraftRunReclaimRequest,
    DraftRunReclaimResponse,
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
    FeatureSpecRequest,
    FeatureSpecResponse,
    ExportRequest,
    ExportStatsResponse,
    FeaturesRequest,
    HistogramRequest,
    HistogramResponse,
    MaterializeRequest,
    MetadataRequest,
    MetadataResponse,
    ModelRunPredictionsRequest,
    ModelRunPredictionsResponse,
    PreviewRequest,
    PreviewResponse,
    CorrelationRequest,
    CorrelationResponse,
    PrepareHoldoutForRunRequest,
    ReplayHoldoutForRunRequest,
    ReplayHoldoutRequest,
    ResplitHoldoutRequest,
    RunLossHistoryRequest,
    RunLossHistoryResponse,
    RunManifestRequest,
    RunManifestResponse,
    RowsRequest,
    RowsResponse,
    ScaleRequest,
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
from services.export_service import export_artifact_csv
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
    except ObjectNotFoundError as e:
        # DS-LAKE-025. The artifact's BYTES ARE GONE — distinct from the
        # 422 below, which means storage refused an otherwise-valid
        # operation. Must sit ABOVE that branch: `ObjectNotFoundError`
        # subclasses `ObjectStoreError`, so the broader `except` would
        # swallow it if it came first.
        #
        # 404 rather than 422 because the caller's request was well-formed
        # and the remedy is different in kind: nothing about the body can
        # be corrected, the object has to be re-materialized from the
        # upstream source. NestJS keys the recovery affordance it shows the
        # user off this status, so collapsing the two back together would
        # put a raw MinIO string in front of the user again with no action
        # attached — the exact failure DS-LAKE-025 was opened for.
        raise HTTPException(status_code=404, detail=str(e))
    except ObjectStoreError as e:
        # Storage refused the read/write — transient or misconfigured.
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
    "/resplit-holdout",
    response_model=ArtifactStatsResponse,
    summary="Re-split an existing pristine BRONZE against a new holdout window",
    description=(
        "DS-LAKE-018-T06: companion to `/materialize`'s own holdout branch, "
        "used when the holdout is changed AFTER the artifact already exists. "
        "`source_key` MUST be a PRISTINE (never-split) BRONZE — NestJS "
        "resolves the draft's root artifact and refuses one that was already "
        "split, since re-splitting a split result would permanently shed "
        "rows. Writes a new artifact; the source is never modified in place."
    ),
)
async def resplit_holdout(
    body: ResplitHoldoutRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.resplit_holdout, store, body)


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
    "/scale",
    response_model=ArtifactStatsResponse,
    summary="Scale a feature-stage artifact and write feature_spec.json",
    description=(
        "DS-LAKE-022-T02. The trailing half of the old combined `/features` "
        "write, split out so a caller can clean BETWEEN feature computation "
        "and scaling. Reads `source_key` (a feature-stage artifact — "
        "typically `/features` called with `scale: false`, optionally "
        "cleaned since), writes `target_key` (the GOLD artifact) — "
        "toModelReady only. Writes feature_spec.json beside the data; "
        "`feature_spec_key` in the response is what NestJS persists as "
        "DatasetArtifact.featureSpecKey."
    ),
)
async def create_scale(
    body: ScaleRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.scale, store, body)


@router.post(
    "/replay-holdout",
    response_model=ArtifactStatsResponse,
    summary="Replay a saved recipe over the raw validation holdout",
    description=(
        "DS-LAKE-018-T04. Reads `source_key` (validate_data.parquet — the "
        "holdout window plus its lead-in), writes `target_key` (the "
        "model-ready holdout, ready to score). Runs applyFeatures -> "
        "selectColumns -> toModelReady only — the holdout stays raw, no "
        "cleaning/imputation step. Scaler params come from `scaling_params` "
        "and are SUPPLIED, never re-fit. Refuses with 422 when the captured "
        "lead-in falls short of the recipe's own deepest lag/rolling "
        "lookback, naming both numbers."
    ),
)
async def replay_holdout(
    body: ReplayHoldoutRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.replay_holdout, store, body)


@router.post(
    "/replay-holdout-for-run",
    response_model=ArtifactStatsResponse,
    summary="Replay a training run's own GOLD recipe over its raw holdout",
    description=(
        "DS-LAKE-018-T05. `replay_holdout`, sourced from `feature_spec_key`'s "
        "own feature_spec.json instead of the caller re-supplying the recipe "
        "— what claim() (model-run.authorized.service.ts) calls to build the "
        "container's holdoutDataUrl. Refuses with 422 if the recipe's "
        "target_y is scaled (no inverse transform recorded)."
    ),
)
async def replay_holdout_for_run(
    body: ReplayHoldoutForRunRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.replay_holdout_for_run, store, body)


@router.post(
    "/prepare-holdout-for-run",
    response_model=ArtifactStatsResponse,
    summary="Scale a training run's already feature-bearing holdout",
    description=(
        "DS-LAKE-023-T03. The SILVER-branch counterpart to "
        "replay-holdout-for-run — for a holdout produced by the reordered "
        "features-stage split (FeaturesRequest.holdout), which already "
        "carries its derived columns and has no lead-in rows. Only the "
        "FITTED scaler transform runs, never re-fit. Refuses with 422 if "
        "the recipe's target_y is scaled, or if a scaled tag has no "
        "recorded scalingParams entry (would silently re-fit on the "
        "holdout's own statistics)."
    ),
)
async def prepare_holdout_for_run(
    body: PrepareHoldoutForRunRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.prepare_holdout_for_run, store, body)


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
    "/feature-spec",
    response_model=FeatureSpecResponse,
    summary="feature_spec.json sidecar for a committed artifact",
    description=(
        "DS-LAKE-025-T06. Reads ONLY feature_spec.json — the data object is "
        "never opened, exactly like /column-stats above. Exists so a display "
        "surface can read `scalingParams` (what each scaler actually FIT) and "
        "present engineering units from a model-ready artifact's scaled "
        "bytes, without unscaling anything: T06 read 6 established that FINAL "
        "being scaled is load-bearing for training. A missing sidecar is a "
        "422, same as /column-stats."
    ),
)
async def read_feature_spec(
    body: FeatureSpecRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.feature_spec, store, body)


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
    "/models/runs/reclaim",
    response_model=DraftRunReclaimResponse,
    summary="Delete one ModelDraft's training-run objects",
    description=(
        "MODEL-FLOW-011-T02. Called by ModelDraftCleanupAdminService once "
        "Postgres has proven the draft eligible (stale ACTIVE past its idle "
        "window, or ABANDONED with objectsReclaimedAt still null). run_id "
        "omitted reclaims the whole drafts/{draft_id}/runs/ subtree in one "
        "call; run_id given reclaims exactly that run, leaving every "
        "sibling — including any run a Model has adopted by pointer — "
        "untouched. Idempotent, same as /artifacts/reclaim: a retried call "
        "on an already-reclaimed prefix returns deleted: 0."
    ),
)
async def reclaim_draft_runs(
    body: DraftRunReclaimRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.reclaim_draft_runs, store, body)


@router.post(
    "/artifacts/adopt",
    response_model=ArtifactAdoptResponse,
    summary="Copy one artifact's objects into a dataset's own prefix",
    description=(
        "DS-LAKE-025. Called by saveDraftAsDatasetService for the FINAL it "
        "is adopting and that FINAL's lineage-root BRONZE, so a saved "
        "dataset owns its bytes instead of borrowing the draft's. Copies "
        "data + every sidecar server-side from "
        "drafts/{draftId}/artifacts/{artifactId}/ to "
        "{datasetId}/artifacts/{artifactId}/ and returns the new keys. "
        "The source objects are left in place — removing them is cleanup's "
        "job, never Save's. Idempotent: objects already at the destination "
        "are reported, not re-copied, so a retried Save converges. Same "
        "guard as /artifacts/reclaim — anything that is not a committed "
        "artifact data key is refused."
    ),
)
async def adopt_artifact(
    body: ArtifactAdoptRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.adopt_artifact, store, body)


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
    return await _run(artifact_service.presign_artifact, store, body)


@router.post(
    "/models/runs/presign-upload",
    response_model=ModelRunUploadPresignResponse,
    summary="Time-limited write URLs for one training run's outputs",
    description=(
        "The write half of /artifacts/presign. Takes exactly one of "
        "model_id (Save Model has happened) or draft_id (training against "
        "a wizard ModelDraft, MODEL-FLOW-003-T08) and refuses any key "
        "outside that owner's own models/{id}/runs/{runId}/ or "
        "drafts/{id}/runs/{runId}/ root, so a run cannot be talked into "
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


@router.post(
    "/models/runs/predictions",
    response_model=ModelRunPredictionsResponse,
    summary="Parsed actual/predicted series for one training run's test split",
    description=(
        "MODEL-FLOW-004. `predictions.parquet` is exactly "
        "{timestamp, y_true, y_pred} over the run's TEST split, not the "
        "wide {timestamp, tag, tag__status, ...} shape /rows assumes, so it "
        "cannot go through that endpoint. `source_key` is guarded "
        "structurally (a well-formed drafts/ or models/ run key naming "
        "predictions.parquet) rather than by an id pair — the caller "
        "already resolved which run's key this is. Every scalar is computed "
        "over the FULL frame; there is no decimation branch, so a test "
        "split over the point cap is refused by name rather than silently "
        "sampled."
    ),
)
async def run_predictions(
    body: ModelRunPredictionsRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.run_predictions, store, body)


@router.post(
    "/models/runs/loss-history",
    response_model=RunLossHistoryResponse,
    summary="A training run's loss_history.json, read and shape-checked",
    description=(
        "MODEL-FLOW-013-T05/T07. `loss_history.json` is already exactly the "
        "response shape (extract_loss_history in images/trainer/train.py "
        "writes it that way on purpose) — this is a read-and-validate, not "
        "a parse-and-reshape like /models/runs/predictions. `source_key` is "
        "guarded the same structural way that endpoint guards its own."
    ),
)
async def run_loss_history(
    body: RunLossHistoryRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.get_run_loss_history, store, body)


@router.post(
    "/models/runs/manifest",
    response_model=RunManifestResponse,
    summary="A training run's framework_versions, from run_manifest.json",
    description=(
        "MODEL-FLOW-007-T11. Every other manifest field already has a column "
        "on ModelTrainingRun (written by /complete) — this exists only for "
        "framework_versions, which does not. Null for a run trained before "
        "the trainer image that added it; Save Model treats that as 'not "
        "recorded', not a failure."
    ),
)
async def run_manifest(
    body: RunManifestRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(artifact_service.get_run_manifest, store, body)


@router.post(
    "/export",
    response_model=ExportStatsResponse,
    summary="Export a committed artifact as CSV",
    description=(
        "DS-LAKE-021. Streams the source artifact's data.parquet into a "
        "sidecar CSV, row-group by row-group. __status columns are "
        "dropped; a Bad-status cell exports as an empty field, never the "
        "raw 0.0 the Parquet stores."
    ),
)
async def export_pipeline(
    body: ExportRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(export_artifact_csv, store, body)
