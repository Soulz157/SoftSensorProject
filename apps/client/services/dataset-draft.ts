import { fetchClient } from '@/lib/fetcher'
import type { DataRow, ScalerMethod } from '@/lib/preprocessing'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type { PipelineConfig } from '@/lib/pipeline-config'
import type {
  CleaningOperationInput,
  CreateRawVersionInput,
  PreprocessingJobStatus,
} from '@/services/dataset-version'

/**
 * `DatasetDraft` — the Dataset Creation wizard's server-side owner while no
 * `Dataset` row exists yet (Draft-first architecture, DS-LAKE-005).
 *
 * Deliberately mirrors `services/dataset-version.ts`'s shape closely: same
 * pipeline, scoped to a draft instead of a saved dataset. `CleaningOperationInput`
 * and `CreateRawVersionInput` are reused as-is — the request shape a browser
 * sends to fetch or clean data does not change with the owner, only the URL.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export type DatasetDraftStatus = 'ACTIVE' | 'SAVED' | 'ABANDONED'

/** Pipeline stage of a `DatasetArtifact` row — BRONZE (raw fetch) through
 * FINAL (adopted at Save). Named here because it is the artifact's own
 * identity, not draft- or dataset-specific; `SavedDataset.currentArtifactType`
 * (`store/datasets.ts`) and `VersionRowsState.stage`
 * (`hooks/dataset/use-dataset-version-rows.ts`) both reuse it rather than
 * declaring a second copy of the same four literals. */
export type DatasetArtifactStage = 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL'

export interface DatasetDraft {
  id: string
  name: string | null
  workspaceId: string
  sourceIds: string[]
  status: DatasetDraftStatus
  currentArtifactId: string | null
  savedDatasetId: string | null
  // DS-LAKE-024. Set for a draft opened by editing an existing saved
  // Dataset (`resolveOrCreateForDataset`'s own response); null for a
  // create-mode draft.
  editingDatasetId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * DS-LAKE-024-T04. `resolveOrCreateForDataset`'s own response shape —
 * `rootValidationRowCount` is the edit draft's root BRONZE's own
 * `validationRowCount` (null = pristine, safe to re-split; non-null =
 * already split at materialize time). Not on `DatasetDraft` itself: the
 * other four endpoints that return one (create/get/abandon/touch) have no
 * edit-draft root to report this about.
 */
export interface EditDraftResolution extends DatasetDraft {
  rootValidationRowCount: number | null
  /**
   * DS-LAKE-027. True when the server found this draft's `currentArtifactId`
   * pointing at an artifact whose bytes were reclaimed (DS-LAKE-014's idle
   * sweep, working as designed) and re-pointed it at the draft's own live
   * BRONZE root. The id in `currentArtifactId` is the recovered one, so
   * nothing downstream needs to branch on this — it exists only so the
   * wizard can say WHY the feature-engineering result the user left behind
   * is no longer there and is about to be recomputed.
   */
  recoveredFromReclaimedArtifact: boolean
}

export interface DraftArtifact {
  id: string
  runId: string
  type: DatasetArtifactStage
  checksum: string
  rowCount: number
  columnCount: number
  missingPct: number
  /** DS-LAKE-006-T06. Only present on a `/features` (GOLD) response. */
  parentArtifactId?: string | null
  featureSpecKey?: string | null
  /** DS-LAKE-009-T01. Only present on a `/finalize` (FINAL) response. */
  validationKey?: string | null
  qualityScore?: number
}

/** DS-LAKE-009-T02 `/save` response — note there is no `name` field; the
 * caller already has it (it just sent it in the request body). */
export interface SavedDataset {
  id: string
  versionId: string
  versionNumber: number
  artifactId: string
  qualityScore: number
  lineage: Array<{
    id: string
    type: DatasetArtifactStage
    checksum: string
    objectKey: string
  }>
}

/** Mirrors apps/python `schemas.preprocess.ValidationCheckResponse` field
 * for field, same snake_case-wire convention as `DraftPreviewResult`. */
export interface ValidationCheck {
  name: string
  passed: boolean
  skipped: boolean
  detail: string
  measured: number | null
  threshold: number | null
  offenders: string[]
  /** DS-LAKE-019-T03. A property of the check's NAME (validation_service
   * .BLOCKING_CHECKS), not a per-result judgment — mirrored, never
   * re-derived client-side. */
  severity: 'blocking' | 'advisory'
}

/** Mirrors apps/python `schemas.preprocess.ValidationReportResponse`
 * (DS-LAKE-007-T02/T03) via NestJS's `ValidationReportSchema.parse`. */
export interface ValidationReport {
  status: 'PASS' | 'FAIL'
  quality_score: number
  checks: ValidationCheck[]
  failed_checks: string[]
  /** DS-LAKE-019-T03. Failed checks that did NOT flip `status` to FAIL —
   * a strict subset of `failed_checks`. */
  advisory_failures: string[]
  validation_report_key: string
}

export interface DraftPreprocessingJob {
  id: string
  status: PreprocessingJobStatus
  stage: 'RAW' | 'CLEAN' | 'FEATURE'
  progress: number
  currentStep: string | null
  totalSteps: number
  completedSteps: number
  estimatedRemainingMs: number | null
  error: string | null
  attempts: number
  sourceArtifactId: string | null
  resultArtifactId: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface DraftRowsPage {
  totalRowCount: number
  offset: number
  tags: string[]
  rows: DataRow[]
}

interface DraftPreviewColumnStats {
  tag: string
  count: number
  missing: number
  missing_pct: number
  min: number | null
  max: number | null
  mean: number | null
  median: number | null
  std: number | null
  /**
   * p1/p5/p10/p20/p80/p90/p95/p99 (DS-LAKE-005B-B-T01, edit 3) — recomputed
   * live over whatever operations THIS preview just applied. No current
   * caller reads this yet; it exists so `percentileBounds` (precleanse.ts)
   * has a real bound to switch to instead of deriving one from a viewport.
   */
  percentiles: Record<string, number> | null
}

interface DraftPreviewSide {
  row_count: number
  column_count: number
  missing_cells: number
  missing_pct: number
  columns: DraftPreviewColumnStats[]
  rows: DataRow[]
}

/** Mirrors apps/python `schemas.preprocess.PreviewResponse` (T01 hybrid). */
export interface DraftPreviewResult {
  source_key: string
  sampled: boolean
  sampled_rows: number
  source_row_count: number
  before: DraftPreviewSide
  after: DraftPreviewSide
  delta: {
    row_count: number
    column_count: number
    missing_cells: number
    missing_pct: number
  }
  warnings: string[]
}

/** One overlaid tag's distribution + KDE curve. Mirrors apps/python
 * `schemas.preprocess.TagHistogram` field for field, same snake_case-wire
 * convention as `DraftPreviewResult` — the backend service returns Python's
 * response unmapped (`getDraftArtifactHistogramService`), same as preview. */
export interface DraftTagHistogram {
  tag: string
  mean: number
  median: number
  mode: number
  std: number
  min: number
  max: number
  range: number
  count: number
  /** Already rescaled onto the count axis server-side (density * n *
   * binWidth) — NOT a raw density curve. Ready to plot as-is. */
  kde: { x: number; y: number }[]
}

/**
 * Mirrors apps/python `schemas.preprocess.HistogramResponse`
 * (DS-LAKE-005B-D-T01). `domain_min`/`domain_max` are `null` together when
 * no requested tag qualifies (fewer than 2 Good values) — never
 * independently null, since the domain is one shared value across every
 * overlaid tag, not per-tag.
 */
export interface DraftHistogramResult {
  source_key: string
  domain_min: number | null
  domain_max: number | null
  tags: DraftTagHistogram[]
  insufficient_tags: string[]
}

/** One tag's five-number summary + capped outlier list. Mirrors apps/python
 * `schemas.preprocess.TagBoxplot` field for field, same snake_case-wire
 * convention as `DraftPreviewResult`/`DraftHistogramResult` — the backend
 * service returns Python's response unmapped. */
export interface DraftTagBoxplot {
  tag: string
  min: number
  q1: number
  median: number
  mean: number
  q3: number
  max: number
  whisker_low: number
  whisker_high: number
  /** CAPPED at the request's `outlierCap` — see `outlier_count` for the
   * true, uncapped total. `outliers.length < outlier_count` means truncated. */
  outliers: number[]
  outlier_count: number
  count: number
}

/** Mirrors apps/python `schemas.preprocess.BoxplotResponse`
 * (DS-LAKE-005B-D-T03). */
export interface DraftBoxplotResult {
  source_key: string
  tags: DraftTagBoxplot[]
  insufficient_tags: string[]
}

/** One decimated plot point. Mirrors apps/python
 * `schemas.preprocess.ScatterPoint`. */
export interface DraftScatterPoint {
  x: number
  y: number
}

/**
 * Mirrors apps/python `schemas.preprocess.ScatterResponse`
 * (DS-LAKE-005B-D-T04), same snake_case-wire convention as
 * `DraftHistogramResult`/`DraftBoxplotResult` — returned unmapped.
 *
 * `points` is DECIMATED (server-side 2D grid binning) for plotting only —
 * `n`/`slope`/`intercept`/`r2` are always computed over the FULL
 * Good-filtered frame, never the decimated sample. A pair counts toward
 * `n` only when BOTH x and y are Good — deliberately NOT the same rule
 * `lib/preprocessing.ts::toScatterPoints` uses (status-blind); this is a
 * tracked divergence, not a bug — see `scatter_service.py`'s own docstring.
 */
export interface DraftScatterResult {
  source_key: string
  x_tag: string
  y_tag: string
  points: DraftScatterPoint[]
  n: number
  slope: number
  intercept: number
  r2: number
  downsampled: boolean
}

/**
 * Mirrors apps/python `schemas.preprocess.CorrelationResponse`
 * (DS-LAKE-005B-D-T05b), same snake_case-wire convention as the other
 * chart results — returned unmapped.
 *
 * `tags` is the RESOLVED list (server-side auto-pick, near-constant
 * filter + IQR/median-or-CV ranking, DS-LAKE-005B-D-T05a) — never assume
 * it equals the request's own `tags`; the client cannot infer which
 * columns it got and must read this field, not re-derive it.
 */
export interface DraftCorrelationResult {
  source_key: string
  tags: string[]
  /** `matrix[i][j]` is the correlation between `tags[i]` and `tags[j]`. */
  matrix: number[][]
  /** Which ranking metric ("iqr_median" | "cv") placed each resolved tag. */
  column_metrics: Record<string, string>
  insufficient_tags: string[]
  near_constant_tags: string[]
  total_candidates: number
}

/**
 * DS-LAKE-005B-B-T01 (Step 5 leg). `GET .../artifacts/:artifactId/metadata`'s
 * response shape — bounded viewport metadata, never a row payload
 * (DS-LAKE-005B-A-T01). `tags` is the artifact's full logical tag-name list;
 * at 8,000 tags this is a tens-of-KB array, accepted deliberately (still
 * bounded by schema width, never by row count) rather than adding a second
 * `/tags?search=` round trip for the one caller that only needs a boolean.
 */
export interface DraftArtifactMetadata {
  id: string
  runId: string
  type: DatasetArtifactStage
  parentArtifactId: string | null
  checksum: string
  rowCount: number
  tagCount: number
  columnCount: number
  missingPct: number
  sizeBytes: string
  tags: string[]
  startTime: string | null
  endTime: string | null
  createdAt: string
}

const base = '/api/v1/authorized/dataset-drafts'
const one = (draftId: string) => `${base}/${encodeURIComponent(draftId)}`

export const datasetDraftService = {
  create: (body: {
    workspaceId: string
    sourceIds: string[]
    name?: string
  }): Promise<ApiResponse<DatasetDraft>> =>
    fetchClient(base, { method: 'POST', body: JSON.stringify(body) }),

  get: (draftId: string): Promise<ApiResponse<DatasetDraft>> =>
    fetchClient(one(draftId), { method: 'GET' }),

  /**
   * DS-LAKE-024-T02. Resolve-or-create the edit-mode draft for a saved
   * Dataset — idempotent on re-entry (200 if an ACTIVE draft already
   * exists, 201 if one was just minted from the dataset's adopted BRONZE).
   * Never re-materializes from the source.
   */
  resolveOrCreateForDataset: (
    datasetId: string,
  ): Promise<ApiResponse<EditDraftResolution>> =>
    fetchClient(`${base}/for-dataset/${encodeURIComponent(datasetId)}`, {
      method: 'POST',
    }),

  abandon: (draftId: string): Promise<ApiResponse<DatasetDraft>> =>
    fetchClient(`${one(draftId)}/abandon`, { method: 'POST' }),

  /**
   * DS-LAKE-014-T04: heartbeat. Bumps the draft's updatedAt while it is
   * ACTIVE; a no-op once SAVED/ABANDONED. Called by
   * `useDatasetDraftHeartbeat` — see that hook for the visibility-gated
   * cadence.
   */
  touch: (draftId: string): Promise<ApiResponse<{ touched: boolean }>> =>
    fetchClient(`${one(draftId)}/touch`, { method: 'POST' }),

  /** Materialize the draft's BRONZE artifact. Runs inline; can take minutes. */
  materialize: (
    draftId: string,
    body: CreateRawVersionInput,
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(`${one(draftId)}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * DS-LAKE-018-T06. Re-splits the draft's PRISTINE (never-split) root
   * BRONZE against a new holdout window, without re-fetching from the
   * source. `holdout: null` clears a previously-picked holdout — the
   * server points the draft back at its pristine artifact without calling
   * Python. Refuses (422) if the draft's resolved root was already split
   * at fetch time (a legacy artifact from before this task).
   */
  resplitHoldout: (
    draftId: string,
    body: { holdout: { from: string; to: string } | null },
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(`${one(draftId)}/holdout`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Before/after comparison against a draft artifact. Writes nothing. */
  preview: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      precision?: Record<string, number>
      sampleRows?: number
      previewRows?: number
    },
  ): Promise<ApiResponse<DraftPreviewResult>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/preview`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-005B-D-T01. Histogram/KDE for one or more tags, recomputed
   * under `operations` against a draft artifact. Writes nothing — same
   * read-only guarantee as `preview()`. `tags` is REQUIRED (unlike
   * `preview`'s optional `tags`): the domain is shared across every
   * overlaid tag, so "every tag" is never a sane default here. */
  histogram: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      tags: string[]
      precision?: Record<string, number>
      sampleRows?: number
      startTime?: string
      endTime?: string
      kdeSamples?: number
      binCount?: number
    },
    /** DS-LAKE-005B-D-T06. Forwarded straight to `fetch` — lets
     * `useDebouncedAbortableRequest` cancel an in-flight request the
     * moment it's superseded, not just ignore its eventual response. */
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftHistogramResult>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/histogram`,
      { method: 'POST', body: JSON.stringify(body), signal },
    ),

  /** DS-LAKE-005B-D-T03. Five-number summary + capped outlier list per tag,
   * recomputed under `operations` against a draft artifact. Writes nothing —
   * same read-only guarantee as `preview()`/`histogram()`. */
  boxplot: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      tags: string[]
      precision?: Record<string, number>
      sampleRows?: number
      startTime?: string
      endTime?: string
      outlierCap?: number
    },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftBoxplotResult>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/boxplot`,
      { method: 'POST', body: JSON.stringify(body), signal },
    ),

  /** DS-LAKE-005B-D-T04. Decimated scatter cloud + full-frame regression
   * for two tags, recomputed under `operations` against a draft artifact.
   * Writes nothing — same read-only guarantee as `preview()`/`histogram()`/
   * `boxplot()`. `xTag`/`yTag` are REQUIRED (unlike `tags` elsewhere): a
   * scatter plot has a fixed 2D shape, not an N-tag overlay. */
  scatter: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      xTag: string
      yTag: string
      precision?: Record<string, number>
      sampleRows?: number
      startTime?: string
      endTime?: string
      maxPoints?: number
    },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftScatterResult>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/scatter`,
      { method: 'POST', body: JSON.stringify(body), signal },
    ),

  /** DS-LAKE-005B-D-T05b. Correlation matrix over a server-resolved column
   * list, recomputed under `operations` against a draft artifact. Writes
   * nothing — same read-only guarantee as the other chart endpoints.
   * `tags` is the CANDIDATE universe (required, same convention as
   * `histogram()`/`boxplot()`/`scatter()`) — the server resolves it down
   * to at most `topK` columns; the response echoes what was resolved. */
  correlation: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      tags: string[]
      precision?: Record<string, number>
      sampleRows?: number
      startTime?: string
      endTime?: string
      topK?: number
    },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftCorrelationResult>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/correlation`,
      { method: 'POST', body: JSON.stringify(body), signal },
    ),

  rows: (
    draftId: string,
    artifactId: string,
    params: { offset: number; limit: number },
  ): Promise<ApiResponse<DraftRowsPage>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/rows` +
        `?offset=${params.offset}&limit=${params.limit}`,
      { method: 'GET' },
    ),

  /** DS-LAKE-005B-B-T01 (Step 5 leg). Bounded viewport metadata, never a row
   * payload (DS-LAKE-005B-A-T01) — schema/time-range/quality summary read
   * off the artifact's own footer. First real caller is
   * `useDatasetArtifactMetadata`, added alongside this method. */
  metadata: (
    draftId: string,
    artifactId: string,
  ): Promise<ApiResponse<DraftArtifactMetadata>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/metadata`,
      { method: 'GET' },
    ),

  /** 202 + jobId. Poll `job()` — the request never waits on the pipeline. */
  clean: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      precision?: Record<string, number>
      /** DS-LAKE-022-T04..T07. Present ONLY from the reordered wizard: the
       * feature recipe whose scaling tail runs after these cleaning ops,
       * committing GOLD (pipelineVersion 2) instead of SILVER. The server
       * refuses (422) unless `artifactId` was produced by a reordered
       * FEATURE job (pipelineVersion 2). */
      scaleRecipe?: {
        features: FeatureConfig[]
        selectedColumns?: string[] | null
        scalers?: Record<string, ScalerMethod>
        targetY?: string | null
      }
    },
  ): Promise<ApiResponse<{ jobId: string; status: PreprocessingJobStatus }>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/clean`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-006-T06. Inline (not job-queued) — one combined operation, not
   * a chained per-tag pipeline. Runs applyFeatures -> selectColumns ->
   * toModelReady server-side against `artifactId` (normally SILVER),
   * producing a GOLD artifact whose `parentArtifactId` is that source. */
  createFeatures: (
    draftId: string,
    artifactId: string,
    body: {
      features: FeatureConfig[]
      selectedColumns?: string[] | null
      scalers?: Record<string, ScalerMethod>
      targetY?: string | null
    },
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/features`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-006-T06 reversal. 202 + jobId, same shape as `clean()` — poll
   * `job()`. Async replacement for `createFeatures` above; that inline
   * route stays live during the transition, not removed. */
  startFeaturesJob: (
    draftId: string,
    artifactId: string,
    body: {
      features: FeatureConfig[]
      selectedColumns?: string[] | null
      scalers?: Record<string, ScalerMethod>
      targetY?: string | null
      /** DS-LAKE-022-T04..T07. `false` = reordered wizard's feature-only
       * stage (no scaling, no feature_spec.json — commits SILVER). Omitted
       * = legacy combined write, unchanged. */
      scale?: boolean
    },
  ): Promise<ApiResponse<{ jobId: string; status: PreprocessingJobStatus }>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/features/job`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-008-T01. Read-only against `artifactId` (normally GOLD, else
   * SILVER) — writes no data, only its own `validation_report.json`
   * sidecar server-side. No `featureSpecKey` field on the request body:
   * the artifact's own column carries it, forwarded automatically by
   * `validateDraftArtifactService` (DS-LAKE-007-T04). */
  validate: (
    draftId: string,
    artifactId: string,
    body: {
      expectedTags?: string[]
      maxMissingPct?: number
      maxOutlierFraction?: number
    } = {},
  ): Promise<ApiResponse<ValidationReport>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/validate`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-009-T01. Promotes `artifactId` (normally GOLD, else SILVER)
   * into a FINAL artifact — the server REFUSES (422) unless it re-validates
   * PASS, never trusting a client-supplied report. Same override fields as
   * `validate`, forwarded as-is. */
  finalize: (
    draftId: string,
    artifactId: string,
    body: {
      expectedTags?: string[]
      maxMissingPct?: number
      maxOutlierFraction?: number
    } = {},
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/finalize`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** DS-LAKE-009-T02. The ONLY call that creates a persistent Dataset from
   * this draft — adopts the draft's FINAL artifact by pointer (never a raw
   * refetch, never a recipe replay). No `artifactId` param: the server
   * looks up the draft's own FINAL artifact itself. Refuses (422) if none
   * exists or it no longer PASSes; refuses (409) if this draft was already
   * saved once. */
  save: (
    draftId: string,
    body: {
      name: string
      description?: string
      /** DS-LAKE-005B-B-T01 (Step 5 leg). Optional — the server derives the
       * real logical tag list from the FINAL artifact when omitted, rather
       * than trusting a client-computed one. */
      tags?: string[]
      pipelineConfig: PipelineConfig
      fileUrl?: string | null
    },
  ): Promise<ApiResponse<SavedDataset>> =>
    fetchClient(`${one(draftId)}/save`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  job: (
    draftId: string,
    jobId: string,
  ): Promise<ApiResponse<DraftPreprocessingJob>> =>
    fetchClient(`${one(draftId)}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    }),

  cancelJob: (
    draftId: string,
    jobId: string,
  ): Promise<ApiResponse<{ jobId: string; status: 'CANCELED' }>> =>
    fetchClient(`${one(draftId)}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    }),

  retryJob: (
    draftId: string,
    jobId: string,
  ): Promise<
    ApiResponse<{
      jobId: string
      status: PreprocessingJobStatus
      retryOf: string
    }>
  > =>
    fetchClient(`${one(draftId)}/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    }),
}
