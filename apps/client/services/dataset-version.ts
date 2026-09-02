import { fetchClient } from '@/lib/fetcher'
import {
  brandBoundedSample,
  type BoundedSample,
  type Cell,
  type Dataset,
  type DataRow,
} from '@/lib/preprocessing'
import {
  DraftArtifactMetadata,
  DraftBoxplotResult,
  DraftCorrelationResult,
  DraftHistogramResult,
  DraftRowsPage,
  DraftScatterResult,
} from './dataset-draft'

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

/** MODEL-FLOW-016-T09. One expanding-window fold's plan — mirrors
 * apps/python `schemas.preprocess.SplitStatsFold` field for field. No box
 * statistics per this feature's own userDecisions. */
export interface DraftSplitStatsFold {
  cut_timestamp: string
  train_rows: number
  test_rows: number
  distinct: number
}

/** MODEL-FLOW-014-T04. Mirrors apps/python `schemas.preprocess.
 * SplitStatsResponse` field for field — `train`/`test` are
 * `DraftBoxplotResult`-shaped minus `source_key` (which belongs once, at
 * the top), so `TagBoxplotChart` renders either side with no translation
 * layer.
 *
 * MODEL-FLOW-016-T02/T09 widened every ratio-mode field to nullable and
 * added the CV-mode fields: `split_ratio`/`cut_timestamp`/
 * `train_labelled_rows`/`test_labelled_rows`/`train`/`test` are null in
 * n_splits mode, and `n_splits`/`folds` are null in ratio mode —
 * `distinct_labelled_values`/`max_admissible_k` are the only two fields
 * always present in both. */
export interface DraftSplitStatsResult {
  source_key: string
  target_y: string
  split_ratio: number | null
  cut_timestamp: string | null
  train_labelled_rows: number | null
  test_labelled_rows: number | null
  source_rows: number
  train: Omit<DraftBoxplotResult, 'source_key'> | null
  test: Omit<DraftBoxplotResult, 'source_key'> | null
  distinct_labelled_values: number
  max_admissible_k: number
  n_splits: number | null
  folds: DraftSplitStatsFold[] | null
}

export type PreprocessingJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

/**
 * A `PreprocessingJob`'s own stage — RAW→CLEAN→FEATURE, which pipeline leg
 * this job ran. Distinct from `DatasetArtifactStage`
 * (BRONZE/SILVER/GOLD/FINAL, `services/dataset-draft.ts`), which is the
 * ARTIFACT's stage. Prisma's enum backing this column is still literally
 * named `DatasetVersionStage` (`schema.prisma`) — a naming leftover from
 * before `DatasetVersion.stage` was removed and this concept moved onto
 * `PreprocessingJob` — but nothing on the client-visible `DatasetVersion`
 * type has carried a `stage` since (DS-LAKE-013).
 */
export type PreprocessingJobStage = 'RAW' | 'CLEAN' | 'FEATURE'

/**
 * Mirrors `listVersionsService`'s actual response
 * (`dataset-version.authorized.service.ts`) field for field — the previous
 * shape here (`parentVersionId`, `stage: DatasetVersionStage`, `operations`)
 * did not exist on the server at all: `DatasetVersion` has no `stage`
 * column (that concept moved to `PreprocessingJob`), so the one caller that
 * filtered on it (`use-dataset-version-rows.ts`) always got `[]` back
 * (DS-LAKE-013).
 */
export interface DatasetVersion {
  id: string
  datasetId: string
  semanticVersion: string | null
  /** The FINAL artifact this version points to, by reference. Null for a
   * row backfilled before this reshape existed. */
  artifactId: string | null
  versionNumber: number
  status: string
  checksum: string | null
  qualityScore: number | null
  rowCount: number
  /** LOGICAL tags — excludes the timestamp and every `__status` sidecar. */
  columnCount: number
  featureCount: number
  missingPct: number
  sizeBytes: number
  durationMs: number | null
  /** ISO 8601 */
  createdAt: string
  createdBy: string
}

export interface ArtifactTagColumnStats {
  tag: string
  coverage: number
  null_pct: number
  outlier_count: number
  min?: number | null
  max?: number | null
  mean?: number | null
  median?: number | null
  std?: number | null
  drift?: number | null
  percentiles?: Record<string, number> | null
  cleaned: boolean
}

export interface ArtifactColumnStatsResult {
  columnStatsKey: string
  /** Keyed by tag name — O(1) lookup, single page by design. */
  stats: Record<string, ArtifactTagColumnStats>
}

/**
 * DS-LAKE-025-T06. What one scaler FIT on the train rows. Which keys are
 * present depends on the method recorded in `spec.scaling`: `{min,max}` for
 * minmax, `{mean,std}` for standard, `{median,iqr}` for robust. Deliberately
 * a loose record rather than a three-way union — pairing params with their
 * method is `inverseScale`'s job, and a union here would force every reader
 * to narrow before it could even log the value.
 */
export type ArtifactScalingParams = Record<string, number>

export interface ArtifactFeatureSpecResult {
  featureSpecKey: string
  /**
   * Keyed by tag. NULL — not `{}` — when the sidecar predates
   * DS-LAKE-018-T02: "the fit was never recorded" is not "nothing was
   * scaled", and a caller must say so rather than render a scaled number as
   * though it were an engineering value.
   */
  scalingParams: Record<string, ArtifactScalingParams> | null
  /** The whole sidecar, unmodelled — it is versioned and widens over time. */
  spec: Record<string, unknown>
}

export interface PreprocessingJob {
  id: string
  status: PreprocessingJobStatus
  stage: PreprocessingJobStage
  progress: number
  currentStep: string | null
  totalSteps: number
  completedSteps: number
  estimatedRemainingMs: number | null
  error: string | null
  attempts: number
  sourceVersionId: string | null
  resultVersionId: string | null
  /** DS-LAKE-021. Set for an EXPORT-stage job's terminal SUCCEEDED row —
   * the id `GET /:id/export/:artifactId/download` needs. Mirrors
   * `DraftPreprocessingJob.resultArtifactId` (dataset-draft.ts), which
   * already had this field; backend added it here in the same fix that
   * made the download route reachable (getJobService, commit cb0c945). */
  resultArtifactId: string | null
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
  /**
   * DS-LAKE-018-T03. Same `toPiTime`-formatted convention as
   * `startTime`/`endTime`. Absent means no holdout selected.
   */
  holdout?: { from: string; to: string }
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

const artifact = (datasetId: string, artifactId: string) =>
  `${base(datasetId)}/artifacts/${encodeURIComponent(artifactId)}`

export const datasetArtifactService = {
  metadata: (
    datasetId: string,
    artifactId: string,
  ): Promise<ApiResponse<DraftArtifactMetadata>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/metadata`, {
      method: 'GET',
    }),

  columnStats: (
    datasetId: string,
    artifactId: string,
  ): Promise<ApiResponse<ArtifactColumnStatsResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/column-stats`, {
      method: 'GET',
    }),

  /** DS-LAKE-025-T06. `feature_spec.json`, for `scalingParams` — what each
   * scaler actually FIT. Lets a display surface present engineering units
   * from a model-ready artifact's scaled bytes; the artifact itself is never
   * unscaled (T06 read 6: the trainer consumes the scaled bytes and re-fits
   * nothing). 404s when the stage produces no spec (BRONZE) or the sidecar
   * is gone. */
  featureSpec: (
    datasetId: string,
    artifactId: string,
  ): Promise<ApiResponse<ArtifactFeatureSpecResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/feature-spec`, {
      method: 'GET',
    }),

  /** `tags` is optional but NOT decorative: DS-LAKE-012 found the omission
   * live — with no `tags`, the server's `ListRowsSchema` treats it as "every
   * tag" (see that schema's own doc comment) and returns every column's
   * cells for the requested row window, which on an 8,000-tag artifact is
   * tens of megabytes for a 200-row preview. Every caller rendering a bounded
   * preview table MUST pass the tag list it actually displays. */
  rows: (
    datasetId: string,
    artifactId: string,
    params: { offset: number; limit: number; tags?: string[] },
  ): Promise<ApiResponse<DraftRowsPage>> =>
    fetchClient(
      `${artifact(datasetId, artifactId)}/rows` +
        `?offset=${params.offset}&limit=${params.limit}` +
        (params.tags?.length
          ? `&tags=${params.tags.map(encodeURIComponent).join(',')}`
          : ''),
      { method: 'GET' },
    ),

  /** `operations` is sent as `[]` and is not a parameter: see this object's
   * own doc comment. `tags` stays the CANDIDATE universe — the server
   * resolves it down and echoes back what it resolved. */
  correlation: (
    datasetId: string,
    artifactId: string,
    body: { tags: string[]; topK?: number; sampleRows?: number },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftCorrelationResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/correlation`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  histogram: (
    datasetId: string,
    artifactId: string,
    body: {
      tags: string[]
      kdeSamples?: number
      binCount?: number
      sampleRows?: number
    },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftHistogramResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/histogram`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  boxplot: (
    datasetId: string,
    artifactId: string,
    body: { tags: string[]; outlierCap?: number; sampleRows?: number },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftBoxplotResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/boxplot`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  /** Compare-view twin of `correlation` above, over the run's validation
   * holdout sidecar instead of the artifact's own object. Same 404-on-missing
   * discipline as `validationRows` — the sidecar was reclaimed, or the run
   * has no holdout at all. */
  validationCorrelation: (
    datasetId: string,
    artifactId: string,
    body: { tags: string[]; topK?: number; sampleRows?: number },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftCorrelationResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/validation-correlation`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  /** Compare-view twin of `histogram` above, over the run's validation
   * holdout sidecar instead of the artifact's own object. */
  validationHistogram: (
    datasetId: string,
    artifactId: string,
    body: {
      tags: string[]
      kdeSamples?: number
      binCount?: number
      sampleRows?: number
    },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftHistogramResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/validation-histogram`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  /** Compare-view twin of `boxplot` above, over the run's validation holdout
   * sidecar instead of the artifact's own object. */
  validationBoxplot: (
    datasetId: string,
    artifactId: string,
    body: { tags: string[]; outlierCap?: number; sampleRows?: number },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftBoxplotResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/validation-boxplot`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  scatter: (
    datasetId: string,
    artifactId: string,
    body: { xTag: string; yTag: string; maxPoints?: number },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftScatterResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/scatter`, {
      method: 'POST',
      body: JSON.stringify({ operations: [], ...body }),
      signal,
    }),

  /** MODEL-FLOW-014-T04. Both sides of the train/test chronological split
   * from one read — no `operations` sent, unlike every sibling chart call
   * above: this reads a committed FINAL artifact and there is no live-
   * editing scrubber state to replay operations against.
   *
   * MODEL-FLOW-016-T02/T09: `splitRatio`/`nSplits` are EXACTLY ONE —
   * mirrors the server's own `.refine()`. Callers pass whichever mode they
   * want; nothing here defaults one over the other. */
  splitStats: (
    datasetId: string,
    artifactId: string,
    body:
      | {
          tags: string[]
          targetY: string
          splitRatio: number
          nSplits?: never
          sampleRows?: number
          outlierCap?: number
        }
      | {
          tags: string[]
          targetY: string
          splitRatio?: never
          nSplits: number
          sampleRows?: number
          outlierCap?: number
        },
    signal?: AbortSignal,
  ): Promise<ApiResponse<DraftSplitStatsResult>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/split-stats`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  /** MODEL-FLOW-010-T06. `data.holdout` is null — not a 404 — when this
   * dataset has no validation holdout, or the artifact predates
   * `validationMissingPct`. */
  holdout: (
    datasetId: string,
    artifactId: string,
  ): Promise<ApiResponse<{ holdout: ArtifactHoldout | null }>> =>
    fetchClient(`${artifact(datasetId, artifactId)}/holdout`, {
      method: 'GET',
    }),

  /** Compare view (train vs. validation). Same bounded-page contract as
   * `rows` above — `tags` is not decorative here either, same reason. 404s
   * (not an empty page) when the run has no holdout or its sidecar is gone
   * from storage — see `useArtifactValidationRows`'s `missing` state. */
  validationRows: (
    datasetId: string,
    artifactId: string,
    params: { offset: number; limit: number; tags?: string[] },
  ): Promise<ApiResponse<DraftRowsPage>> =>
    fetchClient(
      `${artifact(datasetId, artifactId)}/validation-rows` +
        `?offset=${params.offset}&limit=${params.limit}` +
        (params.tags?.length
          ? `&tags=${params.tags.map(encodeURIComponent).join(',')}`
          : ''),
      { method: 'GET' },
    ),
}

/** MODEL-FLOW-010-T06 response shape for `datasetArtifactService.holdout`. */
export interface ArtifactHoldout {
  holdoutFrom: string
  holdoutTo: string | null
  rowCount: number
  /** Null for a holdout captured before this field existed — the caller
   * must say so, never silently omit the figure or imply a clean 0%. */
  missingPct: number | null
}

export const datasetVersionService = {
  list: (datasetId: string): Promise<ApiResponse<DatasetVersion[]>> =>
    fetchClient(`${base(datasetId)}/versions`, { method: 'GET' }),
  columnStats: (
    datasetId: string,
    versionId: string,
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<ArtifactColumnStatsResult>> =>
    fetchClient(
      `${base(datasetId)}/versions/${encodeURIComponent(
        versionId,
      )}/artifacts/${encodeURIComponent(artifactId)}/column-stats`,
      { method: 'GET', signal },
    ),

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

  /** DS-LAKE-021. Starts an EXPORT-stage job against the dataset's FINAL
   * artifact — poll `job(datasetId, jobId)` for completion. */
  startExport: (datasetId: string): Promise<ApiResponse<{ jobId: string }>> =>
    fetchClient(`${base(datasetId)}/export`, { method: 'POST' }),

  /** DS-LAKE-021. Presigns FRESH on every call — the URL expires, so it
   * must never be cached from job-completion time. */
  exportDownload: (
    datasetId: string,
    artifactId: string,
  ): Promise<ApiResponse<{ downloadUrl: string; expiresAt: string }>> =>
    fetchClient(
      `${base(datasetId)}/export/${encodeURIComponent(artifactId)}/download`,
      { method: 'GET' },
    ),
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

export interface BoundedVersionRowsPage {
  page: BoundedSample
  totalRowCount: number
  offset: number
}

/**
 * ONE bounded page of a version's rows — the windowed counterpart to
 * `fetchVersionDataset`'s accumulate-everything loop (DS-LAKE-005B-B-T01/T04).
 *
 * `fetchVersionDataset` is left completely unchanged: its one caller,
 * `useDatasetVersionRows`, feeds every downstream wizard step a full
 * `Dataset` today (DataAnalysisCard's histogram/boxplot/scatter/correlation
 * tabs and Step 5's client pipeline both need it — see the DS-LAKE-005B-B-T01
 * blockedReason for why neither has a safe bounded replacement yet), so
 * changing what it returns would break real, currently-working consumers.
 *
 * This function has NO production caller yet — it exists so `BoundedSample`
 * has one real, tested construction site today rather than being introduced
 * speculatively. It becomes load-bearing the moment any consumer is ready to
 * read one page at a time instead of accumulating the whole artifact.
 */
export async function fetchVersionRowsPage(
  datasetId: string,
  versionId: string,
  params: { offset: number; limit: number },
): Promise<BoundedVersionRowsPage> {
  const res = await datasetVersionService.rows(datasetId, versionId, params)
  return {
    page: brandBoundedSample({ tags: res.data.tags, rows: res.data.rows }),
    totalRowCount: res.data.totalRowCount,
    offset: params.offset,
  }
}

export type { Cell, DataRow }
