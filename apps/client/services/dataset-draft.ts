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

export interface DatasetDraft {
  id: string
  name: string | null
  workspaceId: string
  sourceIds: string[]
  status: DatasetDraftStatus
  currentArtifactId: string | null
  savedDatasetId: string | null
  createdAt: string
  updatedAt: string
}

export interface DraftArtifact {
  id: string
  runId: string
  type: 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL'
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
    type: 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL'
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
}

/** Mirrors apps/python `schemas.preprocess.ValidationReportResponse`
 * (DS-LAKE-007-T02/T03) via NestJS's `ValidationReportSchema.parse`. */
export interface ValidationReport {
  status: 'PASS' | 'FAIL'
  quality_score: number
  checks: ValidationCheck[]
  failed_checks: string[]
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

  abandon: (draftId: string): Promise<ApiResponse<DatasetDraft>> =>
    fetchClient(`${one(draftId)}/abandon`, { method: 'POST' }),

  /** Materialize the draft's BRONZE artifact. Runs inline; can take minutes. */
  materialize: (
    draftId: string,
    body: CreateRawVersionInput,
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(`${one(draftId)}/artifacts`, {
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

  /** 202 + jobId. Poll `job()` — the request never waits on the pipeline. */
  clean: (
    draftId: string,
    artifactId: string,
    body: {
      operations: CleaningOperationInput[]
      precision?: Record<string, number>
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
    },
  ): Promise<ApiResponse<DraftArtifact>> =>
    fetchClient(
      `${one(draftId)}/artifacts/${encodeURIComponent(artifactId)}/features`,
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
      tags: string[]
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
