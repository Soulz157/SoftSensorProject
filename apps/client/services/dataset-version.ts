import { fetchClient } from '@/lib/fetcher'
import type { Cell, Dataset, DataRow } from '@/lib/preprocessing'

/**
 * Dataset versions and preprocessing jobs.
 *
 * The rows these endpoints return are REAL — read from the committed Parquet
 * artifact in object storage — as opposed to `buildRawDataset`, which derives
 * synthetic readings from a seed. That distinction is the point of this slice,
 * so callers should stay explicit about which of the two they are showing.
 *
 * No credentials cross this boundary: materialising a version sends a
 * `sourceId`, and the server loads and decrypts the secret itself.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export type DatasetVersionStage = 'RAW' | 'CLEAN' | 'FEATURE'

export type PreprocessingJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

export interface DatasetVersion {
  id: string
  datasetId: string
  parentVersionId: string | null
  versionNumber: number
  stage: DatasetVersionStage
  rowCount: number
  /** LOGICAL tags — excludes the timestamp and every `__status` sidecar. */
  columnCount: number
  missingPct: number
  sizeBytes: number
  operations: unknown
  durationMs: number | null
  /** ISO 8601 */
  createdAt: string
  createdBy: string
}

export interface PreprocessingJob {
  id: string
  status: PreprocessingJobStatus
  stage: DatasetVersionStage
  progress: number
  currentStep: string | null
  totalSteps: number
  completedSteps: number
  estimatedRemainingMs: number | null
  error: string | null
  attempts: number
  sourceVersionId: string | null
  resultVersionId: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** One page of stored rows, in the wide shape the wizard already renders. */
export interface VersionRowsPage {
  /** The WHOLE artifact, not this page — page until offset + rows >= this. */
  totalRowCount: number
  offset: number
  tags: string[]
  rows: DataRow[]
}

export interface CreateRawVersionInput {
  sourceId: string
  tags: string[]
  /** `YYYY-MM-DD HH:mm:ss.SSSSSS`, naive Bangkok local — see `toPiTime`. */
  startTime: string
  endTime: string
  summaryDuration?: string
  /** SQL sources only. */
  timestampColumn?: string
  table?: string
}

export interface CleaningOperationInput {
  type: string
  method?: string
  tags?: string[]
  param?: number
  paramLow?: number
  window?: number
  alpha?: number
  threshold?: number
  value?: number
  min?: number
  max?: number
}

const base = (datasetId: string) =>
  `/api/v1/authorized/dataset/${encodeURIComponent(datasetId)}`

export const datasetVersionService = {
  list: (datasetId: string): Promise<ApiResponse<DatasetVersion[]>> =>
    fetchClient(`${base(datasetId)}/versions`, { method: 'GET' }),

  /** Materialise V1 from a saved source. Runs inline; can take minutes. */
  createRaw: (
    datasetId: string,
    body: CreateRawVersionInput,
  ): Promise<ApiResponse<DatasetVersion>> =>
    fetchClient(`${base(datasetId)}/versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  rows: (
    datasetId: string,
    versionId: string,
    params: { offset: number; limit: number },
  ): Promise<ApiResponse<VersionRowsPage>> =>
    fetchClient(
      `${base(datasetId)}/versions/${encodeURIComponent(versionId)}/rows` +
        `?offset=${params.offset}&limit=${params.limit}`,
      { method: 'GET' },
    ),

  /** Before/after comparison. Writes nothing — no job, no version, no object. */
  preview: (
    datasetId: string,
    versionId: string,
    body: {
      operations: CleaningOperationInput[]
      precision?: Record<string, number>
      sampleRows?: number
      previewRows?: number
    },
  ): Promise<ApiResponse<unknown>> =>
    fetchClient(
      `${base(datasetId)}/versions/${encodeURIComponent(versionId)}/preview`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** 202 + jobId. Poll `job()` — the request never waits on the pipeline. */
  clean: (
    datasetId: string,
    versionId: string,
    body: {
      operations: CleaningOperationInput[]
      precision?: Record<string, number>
    },
  ): Promise<ApiResponse<{ jobId: string; status: PreprocessingJobStatus }>> =>
    fetchClient(
      `${base(datasetId)}/versions/${encodeURIComponent(versionId)}/clean`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  job: (
    datasetId: string,
    jobId: string,
  ): Promise<ApiResponse<PreprocessingJob>> =>
    fetchClient(`${base(datasetId)}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    }),

  cancelJob: (
    datasetId: string,
    jobId: string,
  ): Promise<ApiResponse<{ jobId: string; status: 'CANCELED' }>> =>
    fetchClient(`${base(datasetId)}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    }),

  /** Creates a NEW job; the failed attempt stays on the record. */
  retryJob: (
    datasetId: string,
    jobId: string,
  ): Promise<
    ApiResponse<{
      jobId: string
      status: PreprocessingJobStatus
      retryOf: string
    }>
  > =>
    fetchClient(`${base(datasetId)}/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    }),
}

/**
 * Page a whole version into the wide `Dataset` the wizard renders.
 *
 * No conversion is needed beyond concatenation: the connector already emits
 * `{timestamp, cells: {tag: {value, status}}}` with `status` in
 * `Good | Bad | Questionable`, which is exactly `DataRow`. That alignment is
 * deliberate — a translation layer here would be a second place for the status
 * convention to drift out of step with storage.
 *
 * `onProgress` reports rows loaded so the caller can drive the existing
 * fetch-progress UI without this module importing React.
 */
export async function fetchVersionDataset(
  datasetId: string,
  versionId: string,
  options: {
    pageSize?: number
    signal?: { aborted: boolean }
    onProgress?: (loaded: number, total: number) => void
  } = {},
): Promise<Dataset> {
  const pageSize = options.pageSize ?? 5_000
  const rows: DataRow[] = []
  let tags: string[] = []
  let total = Infinity

  for (let offset = 0; offset < total; offset += pageSize) {
    // Cooperative cancellation: a React caller aborts on unmount so a long
    // hydration cannot write into a dead component's atoms.
    if (options.signal?.aborted) break

    const page = await datasetVersionService.rows(datasetId, versionId, {
      offset,
      limit: pageSize,
    })
    total = page.data.totalRowCount
    if (tags.length === 0) tags = page.data.tags
    rows.push(...page.data.rows)
    options.onProgress?.(rows.length, total)

    // An empty page means the artifact ended early (or shrank between calls).
    // Without this the loop would keep requesting the same tail forever.
    if (page.data.rows.length === 0) break
  }

  return { tags, rows }
}

export type { Cell, DataRow }
