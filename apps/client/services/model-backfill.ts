import { fetchClient } from '@/lib/fetcher'

/**
 * MODEL-SERVE-032. The Evaluation page's server calls, under
 * `authorized/model/:modelId/evaluation`, matching the inference-window
 * service's prefix. Every timestamp on this wire is a UTC instant (ISO `Z`).
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

/** One row of the imported range. `predicted` is null when the row was NOT
 *  scored; `skippedReason` then names the inputs that were not Good. A null
 *  prediction is a gap on the chart, never a zero. */
export interface EvaluationComparePoint {
  t: string
  predicted: number | null
  skippedReason: string | null
}

export interface EvaluationCompareLabEvent {
  t: string
  value: number
}

export interface EvaluationCompareLab {
  /** False for a source that has no recorded-event read (not PI): lab values
   *  are then absent, not substituted. */
  supported: boolean
  /** Raw recorded lab events (Good, numeric) — NOT interval averages. */
  events: EvaluationCompareLabEvent[]
  truncated: boolean
  /** Why lab values are missing when they are; predictions still came back. */
  error: string | null
}

export interface EvaluationCompareResult {
  modelVersionId: string
  version: number
  targetTag: string
  featureColumns: string[]
  /** The schedule's fetch cadence, e.g. '1m'. */
  interval: string
  /** How far apart a lab event and a prediction may be to count as a pair. */
  toleranceMinutes: number
  range: { from: string; to: string }
  counts: { rows: number; scored: number; skipped: number }
  points: EvaluationComparePoint[]
  /** Raw X series, each aligned index-for-index with `points`; null = Bad. */
  features: Record<string, Array<number | null>>
  lab: EvaluationCompareLab
}

export type WriteBackKind = 'PREDICTION' | 'LAB'

/** The model's PI write-back settings, plus what THIS caller may do. */
export interface WriteBackConfigView {
  /** Null until an owner saves output tags. */
  config: {
    sourceId: string
    predictionTag: string | null
    labTag: string | null
    updatedAt: string
  } | null
  /** Workspace owner or admin. Drives enabled / disabled, nothing else: the
   *  server re-checks on every write. */
  canWrite: boolean
  source: {
    id: string
    name: string
    type: string
    /** The PI login a write is attributed to (the source's stored account).
     *  A username, not a secret. */
    piAccount: string
    /** True only for a PI source. */
    writable: boolean
  } | null
  /** The model's schedule was re-pointed after the tags were saved. */
  sourceChanged: boolean
  /** The model's lab target — an output tag may not be this. */
  targetTag: string | null
}

export type WriteBackStatus =
  | 'PENDING'
  | 'WRITING'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED'
  | 'ROLLED_BACK'

/** One write (or rollback) batch as the history lists it. */
export interface WriteBackBatchSummary {
  id: string
  kind: WriteBackKind | 'ROLLBACK'
  tag: string
  status: WriteBackStatus
  pointCount: number
  okCount: number
  failedCount: number
  rangeFrom: string
  rangeTo: string
  modelVersionId: string | null
  rollbackOfId: string | null
  piAccount: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}

/** What a write WOULD do. Nothing was written or claimed. */
export interface WriteBackDryRun {
  dryRun: true
  kind: WriteBackKind
  tag: string
  sourceName: string
  piAccount: string
  pointCount: number
  /** Points where PI already holds a value that this write would replace. */
  overwriteCount: number
  newCount: number
  /** Another write on the same tag is open right now. */
  busy: boolean
}

export interface WriteBackDone {
  dryRun: false
  batch: WriteBackBatchSummary
}

export interface WriteBackRequest {
  kind: WriteBackKind
  points: Array<{ timestamp: string; value: number }>
  /** The version that produced these predictions (compare's `modelVersionId`). */
  modelVersionId?: string
  dryRun?: boolean
}

/** A history row: the batch summary plus who ran it. */
export interface WriteBackHistoryItem extends WriteBackBatchSummary {
  /** Display name or email; null when the user has since been removed. */
  createdBy: string | null
}

export interface WriteBackHistoryPage {
  batches: WriteBackHistoryItem[]
  /** Pass back as `cursor` for the next (older) page; null = no more. */
  nextCursor: string | null
}

/** One point of a batch: what PI held before, what was sent, what PI held
 *  after (read back). `sentValue` is null for a point a rollback removed. */
export interface WriteBackValue {
  timestamp: string
  beforeExisted: boolean
  beforeValue: number | null
  sentValue: number | null
  afterValue: number | null
  itemOk: boolean
  itemError: string | null
}

export interface WriteBackBatchDetail {
  batch: WriteBackHistoryItem & {
    rollbacks: Array<{ id: string; status: WriteBackStatus; createdAt: string }>
  }
  values: WriteBackValue[]
}

/** What a rollback WOULD do. Nothing was claimed or changed. */
export interface RollbackDryRun {
  dryRun: true
  original: {
    id: string
    kind: WriteBackKind | 'ROLLBACK'
    tag: string
    status: WriteBackStatus
    pointCount: number
  }
  tag: string
  piAccount: string
  replaceCount: number
  removeCount: number
  /** Already back to the original, nothing to do. */
  skipCount: number
  /** Hold a system state (not a number); never overwritten, even forced. */
  blockedCount: number
  driftCount: number
  /** First points PI no longer holds what the write left (capped). */
  drift: Array<{
    timestamp: string
    expected: number | null
    actual: number | 'none' | string
  }>
  /** A later overlapping write that must be rolled back first. */
  blockedBy: {
    id: string
    kind: string
    status: string
    createdAt: string
    rangeFrom: string
    rangeTo: string
  } | null
  canProceed: boolean
  canForce: boolean
}

export interface RollbackDone {
  dryRun: false
  batch: WriteBackBatchSummary
  original: WriteBackBatchSummary
}

function base(modelId: string) {
  return `/api/v1/authorized/model/${modelId}/evaluation`
}

export const modelEvaluationService = {
  /**
   * Import a range from the model's data source, score it with the
   * PRODUCTION version now, and return predictions beside the raw lab events
   * and the X series. Persists nothing server-side. The server refuses a
   * range over 31 days or ~2000 rows with a 422 whose message says to narrow
   * it; `fetchClient` carries that text through.
   */
  async compare(
    modelId: string,
    from: string,
    to: string,
  ): Promise<EvaluationCompareResult> {
    const res: ApiResponse<EvaluationCompareResult> = await fetchClient(
      `${base(modelId)}/compare`,
      { method: 'POST', body: JSON.stringify({ from, to }) },
    )
    return res.data
  },
  async getWriteBackConfig(modelId: string): Promise<WriteBackConfigView> {
    const res: ApiResponse<WriteBackConfigView> = await fetchClient(
      `${base(modelId)}/writeback/config`,
    )
    return res.data
  },

  /** Blank / null clears a slot. The server verifies each tag in PI and
   *  refuses (422, with a sentence saying which rule) rather than saving one
   *  it cannot verify. */
  async putWriteBackConfig(
    modelId: string,
    tags: { predictionTag: string | null; labTag: string | null },
  ): Promise<WriteBackConfigView> {
    const res: ApiResponse<WriteBackConfigView> = await fetchClient(
      `${base(modelId)}/writeback/config`,
      { method: 'PUT', body: JSON.stringify(tags) },
    )
    return res.data
  },

  /**
   * Write predictions or lab values to PI. The destination tag is NOT sent:
   * the server takes it from the saved config. With `dryRun: true` it
   * reports what would happen and changes nothing.
   */
  async writeBack(
    modelId: string,
    body: WriteBackRequest,
  ): Promise<WriteBackDryRun | WriteBackDone> {
    const res: ApiResponse<WriteBackDryRun | WriteBackDone> = await fetchClient(
      base(modelId) + '/writeback',
      { method: 'POST', body: JSON.stringify(body) },
    )
    return res.data
  },

  async listWriteBackHistory(
    modelId: string,
    opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
  ): Promise<WriteBackHistoryPage> {
    const q = new URLSearchParams()
    if (opts.cursor) q.set('cursor', opts.cursor)
    q.set('limit', String(opts.limit ?? 20))
    const res: ApiResponse<WriteBackHistoryPage> = await fetchClient(
      `${base(modelId)}/writeback/history?${q.toString()}`,
      { signal: opts.signal },
    )
    return res.data
  },

  async getWriteBackBatch(
    modelId: string,
    batchId: string,
    signal?: AbortSignal,
  ): Promise<WriteBackBatchDetail> {
    const res: ApiResponse<WriteBackBatchDetail> = await fetchClient(
      `${base(modelId)}/writeback/${batchId}`,
      { signal },
    )
    return res.data
  },

  /**
   * Undo one batch. With `dryRun` it reports the later write that blocks it
   * and the points PI no longer holds as written (drift). `force` overrides
   * drift only; a blocking later write is refused with a 409 either way.
   */
  async rollback(
    modelId: string,
    batchId: string,
    body: { force?: boolean; dryRun?: boolean },
  ): Promise<RollbackDryRun | RollbackDone> {
    const res: ApiResponse<RollbackDryRun | RollbackDone> = await fetchClient(
      `${base(modelId)}/writeback/${batchId}/rollback`,
      { method: 'POST', body: JSON.stringify(body) },
    )
    return res.data
  },
}
