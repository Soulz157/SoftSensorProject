import { fetchClient } from '@/lib/fetcher'
import type { DataRow } from '@/lib/preprocessing'
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
