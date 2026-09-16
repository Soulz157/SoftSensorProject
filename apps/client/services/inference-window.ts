import { fetchClient } from '@/lib/fetcher'

/**
 * MODEL-SERVE-006. Schedule/status/backfill/retry — the JWT-facing half of
 * the inference-window feature (container callbacks are server-internal
 * and have no client caller). Lives under `authorized/model/:modelId`,
 * matching `model-version`/`model-monitoring`'s own prefix.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

/**
 * MODEL-SERVE-006-T09. The wizard's five deploy-step guardrails, under
 * their own names (store/model-pipeline.ts's mpAutoRetrainAtom/
 * mpRetrainWarnSdAtom/mpRetrainCriticalSdAtom/mpDriftMonitorAtom/
 * mpDriftThresholdPctAtom) — this is the ONE place they now persist.
 */
export interface InferenceSchedule {
  enabled: boolean
  cadenceMinutes: number | null
  lagMinutes: number | null
  sourceId: string | null
  autoRetrain: boolean
  warnSd: number
  criticalSd: number
  driftMonitor: boolean
  driftThresholdPct: number
  /**
   * MODEL-SERVE-001-T28. Operational health thresholds. API-settable and read
   * back by `getSchedule`, but with no editor yet — the wizard deliberately
   * does not own them (they are runtime tuning, not creation-time choices).
   */
  missingPctWarn: number
  missingPctAlert: number
  skipStreakAlert: number
  frozenWindows: number
  frozenTolerancePct: number
}

/** MODEL-SERVE-001-T09. `reason` already redacted server-side
 *  (`lib/redact-urls.ts`) — never re-sanitize on this side, and never
 *  render a raw one from any OTHER source. */
export interface InferenceWindowFailureNote {
  windowStart: string
  reason: string | null
}

export interface InferenceStatus {
  enabled: boolean
  cadenceMinutes: number | null
  lastSucceededAt: string | null
  lastTerminalAt: string | null
  gapCount: number
  staleness: 'OK' | 'STALE'
  failing: boolean
  /** Latest FAILED window, if any — the reason `error` means what it says. */
  lastFailure: InferenceWindowFailureNote | null
  /** Latest SKIPPED window, if any — NOT an error (a threshold message,
   *  e.g. below INFERENCE_MIN_ROWS). Render distinctly from `lastFailure`;
   *  never let a status word imply the wrong one caused it. */
  lastSkipped: InferenceWindowFailureNote | null
  deployStatus: 'stopped' | 'running' | 'error' | 'initializing'
  /**
   * MODEL-SERVE-001-T21. A SEPARATE axis from `deployStatus` above, never
   * collapsed into it — a model can be `running` (operationally up) while
   * its inputs drift, and a `stopped` model has no reading at all (`OFF`).
   * `thresholds` is this schedule's OWN warnSd/criticalSd/driftThresholdPct
   * (renamed `outOfRangePct`), not the system-wide env defaults the
   * separate Drift tab still reads — null exactly when `status` is `OFF`
   * or `UNKNOWN`.
   */
  health: {
    status: 'OFF' | 'UNKNOWN' | 'OK' | 'WARN' | 'CRITICAL' | 'ALERT' | 'FROZEN'
    /**
     * MODEL-SERVE-001-T26. Why ALERT carries a code: it collapses faults with
     * OPPOSITE ACTIONS. SOURCE_UNREACHABLE/STALE send a reader to the
     * connector or the scheduler; a drift WARN/CRITICAL sends them to the
     * process or to a retrain. Null for every non-ALERT status.
     */
    reason:
      | 'SOURCE_UNREACHABLE'
      | 'STALE'
      | 'NO_PREDICTIONS'
      | 'BAD_DATA'
      | 'SENSOR_FROZEN'
      | 'DRIFT_CRITICAL'
      | 'DRIFT_WARN'
      | null
    /** T29. Which instruments have stopped moving. Rides every status, not
     *  just FROZEN — a higher-precedence fault outranks the band without
     *  making the tags un-stuck. */
    frozenColumns: string[]
    thresholds: {
      warnSd: number
      criticalSd: number
      outOfRangePct: number
    } | null
  }
}

export interface InferenceWindow {
  id: string
  modelId: string
  modelVersionId: string
  windowStart: string
  windowEnd: string
  status:
    | 'PENDING'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'SKIPPED'
    | 'CANCELED'
  inputRows: number | null
  missingPct: number | null
  failureReason: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** MODEL-SERVE-001-T10. One line of the container's own stdout. `message`
 *  arrives already URL-redacted — see `inferenceWindowService.logs`. */
export interface WindowLogLine {
  id: string
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
}

/**
 * MODEL-SERVE-001-T10. The window's own facts, carried alongside its log
 * lines so that ZERO lines is still explainable.
 *
 * A container that reaches `claim` always writes at least one line
 * (`images/trainer/app/pipelines/infer.py` logs "Window claimed." before
 * it downloads anything), so an empty `lines` is never "the container
 * chose to print nothing" — it means no container ever got that far. Which
 * of the four reasons applies is read off `status` plus these fields, and
 * `imageDigest` is null for any window that never ran one.
 */
export interface WindowLogContext {
  id: string
  status:
    | 'PENDING'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'SKIPPED'
    | 'CANCELED'
  windowStart: string
  windowEnd: string
  inputRows: number | null
  missingPct: number | null
  imageDigest: string | null
  /** The discriminator for "did a container actually run". NOT
   *  `imageDigest` — verified live: windows exist with a containerId and a
   *  startedAt whose imageDigest is still null. */
  containerId: string | null
  failureReason: string | null
  attempts: number
  startedAt: string | null
  finishedAt: string | null
}

/**
 * MODEL-SERVE-001-T10. The two records that PRECEDE the container, so the
 * view can answer "from the moment Deploy was pressed" rather than only
 * "what the container printed". `deployedAt`/`deployedBy` are stamped on
 * the schedule's OFF→ON edge only; the promote fields belong to the
 * version this window is pinned to. Every field is nullable — a model
 * deployed before the stamp existed, or whose promoter was deleted, still
 * has readable logs.
 */
export interface WindowProvenance {
  deployedAt: string | null
  deployedBy: string | null
  version: number | null
  stage: string | null
  promotedAt: string | null
  promotedBy: string | null
  /** Set only when the promote crossed the r2 floor with an override. */
  promotionOverrideReason: string | null
}

export interface WindowLogs {
  window: WindowLogContext
  provenance: WindowProvenance
  lines: WindowLogLine[]
  /** True when older lines were dropped to stay under the read cap. */
  truncated: boolean
  /** How many earlier lines were dropped — 0 when `truncated` is false. */
  omittedCount: number
}

/**
 * MODEL-SERVE-005-T03. One joined (lab sample -> nearest prediction) pair.
 * `residual = predicted - actual`, the same convention
 * `lib/model-evaluation.ts` uses, so this can feed `EvalPoint` directly.
 */
export interface LiveErrorPoint {
  timestamp: string
  predicted: number
  actual: number
  residual: number
}

export interface LiveErrorMetrics {
  r2: number
  rmse: number
  mae: number
  sd: number
  bias: number
  n: number
}

/** One model version's own error. A range can hold two versions (a
 *  shadow evaluation), and two versions can predict DIFFERENT targets —
 *  so each group carries the target it was actually scored against. */
export interface LiveErrorVersion {
  modelVersionId: string
  /** Non-null by construction, unlike `LiveErrorWindow.targetColumn`: a
   *  group only exists once a window under it carried pairs, and a join
   *  that produced pairs necessarily resolved its target first. */
  targetColumn: string
  metrics: LiveErrorMetrics | null
  pairedRows: number
  windows: number
}

export interface LiveErrorCoverage {
  windowsInRange: number
  /** T11. A FOURTH empty cause: these windows ran, fetched, and were
   *  deliberately not scored (too few usable rows — a real terminal status,
   *  never a failure). Disjoint from `windowsInRange`, which counts
   *  SUCCEEDED only — so an all-SKIPPED range must not read like "the
   *  scheduler never ran here". */
  windowsSkipped: number
  windowsJoined: number
  /** DISJOINT from `windowsFailed` — a window whose join failed is not a
   *  window waiting on the lab, so the two never count the same window. */
  windowsAwaitingTruth: number
  truthRows: number
  pairedRows: number
  /** Windows the sweeper could not ask about at all — a broken source or an
   *  unresolvable target — as distinct from windows the lab has simply not
   *  reported on yet. Both show zero pairs; only one is a problem. */
  windowsFailed: number
  /** MAX, not a mean — a mean hides the one window whose sensor stopped,
   *  which is exactly what this number exists to surface. */
  maxMissingPct: number | null
  /** MODEL-SERVE-001-T18. This model's own `InferenceSchedule.truthLagMinutes`
   *  — null when the model has no schedule at all (the wait has no meaning
   *  without one). */
  truthLagMinutes: number | null
  /** The earliest time the NEXT truth check happens for a window in range
   *  that has not joined yet — null when nothing is awaiting (every window
   *  already joined or failed, or there is no schedule). Turns an
   *  indefinite "the join runs again" into a checkable one. */
  earliestEligibleAt: string | null
}

export interface LiveErrorWindow {
  windowStart: string
  /** Null only on a window whose join FAILED before the target could be
   *  resolved; any window carrying pairs has one. */
  targetColumn: string | null
  modelVersionId: string
  truthRows: number
  pairedRows: number
  n: number
  missingPct: number | null
  joinedThrough: string
  /** Set only when the join itself failed. */
  failureReason: string | null
}

export interface LiveErrorResult {
  points: LiveErrorPoint[]
  truncated: boolean
  /** Null when nothing has joined, AND null when the range mixes versions
   *  (read `versions` then) — never a zero standing in for absence. */
  metrics: LiveErrorMetrics | null
  mixedVersions: boolean
  versions: LiveErrorVersion[]
  /** The target any window in range knows about, including windows that
   *  joined nothing — so the label survives while a model waits for its
   *  first lab sample. Null only when no window knows it yet. */
  targetColumn: string | null
  coverage: LiveErrorCoverage
  windows: LiveErrorWindow[]
}

function base(modelId: string) {
  return `/api/v1/authorized/model/${modelId}`
}

export const inferenceWindowService = {
  async getSchedule(modelId: string): Promise<InferenceSchedule> {
    const res: ApiResponse<InferenceSchedule> = await fetchClient(
      `${base(modelId)}/inference/schedule`,
    )
    return res.data
  },

  /** Enable/update or disable a model's schedule. Omitted fields keep
   *  their current persisted value (server-side merge, not a replace). */
  async putSchedule(
    modelId: string,
    dto: {
      enabled: boolean
      cadenceMinutes?: number
      lagMinutes?: number
      sourceId?: string
      autoRetrain?: boolean
      warnSd?: number
      criticalSd?: number
      driftMonitor?: boolean
      driftThresholdPct?: number
    },
  ): Promise<Partial<InferenceSchedule>> {
    const res: ApiResponse<Partial<InferenceSchedule>> = await fetchClient(
      `${base(modelId)}/inference/schedule`,
      { method: 'PUT', body: JSON.stringify(dto) },
    )
    return res.data
  },

  async getStatus(
    modelId: string,
    signal?: AbortSignal,
  ): Promise<InferenceStatus> {
    const res: ApiResponse<InferenceStatus> = await fetchClient(
      `${base(modelId)}/inference/status`,
      { signal },
    )
    return res.data
  },

  async listWindows(
    modelId: string,
    params?: { status?: string; from?: string; to?: string },
  ): Promise<InferenceWindow[]> {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.from) query.set('from', params.from)
    if (params?.to) query.set('to', params.to)
    const qs = query.toString()
    const res: ApiResponse<InferenceWindow[]> = await fetchClient(
      `${base(modelId)}/inference/windows${qs ? `?${qs}` : ''}`,
    )
    return res.data
  },

  async backfill(
    modelId: string,
    dto: { from: string; to: string },
  ): Promise<{ requested: number; inserted: number }> {
    const res: ApiResponse<{ requested: number; inserted: number }> =
      await fetchClient(`${base(modelId)}/inference/backfill`, {
        method: 'POST',
        body: JSON.stringify(dto),
      })
    return res.data
  },

  async retryWindow(modelId: string, windowId: string): Promise<void> {
    await fetchClient(`${base(modelId)}/inference/windows/${windowId}/retry`, {
      method: 'POST',
    })
  },

  /**
   * MODEL-SERVE-001-T10. One window's container stdout, with the window's
   * own facts attached so a zero-line window can still say WHY.
   *
   * `windowId` accepts the literal `'latest'`. That is what keeps
   * `models/views`' Console peek and `models/[id]`'s Logs tab on ONE
   * endpoint — the peek holds a Model and has no window id to send, and a
   * second endpoint is exactly the divergence T09 had to close for
   * deployStatus one screen over.
   *
   * `lines` are the NEWEST 500, oldest-first for display, already
   * URL-redacted server-side (`lib/redact-urls.ts`) — never re-sanitize
   * here, and never render a log line from any other source.
   */
  async logs(
    modelId: string,
    windowId: string,
    signal?: AbortSignal,
  ): Promise<WindowLogs> {
    const res: ApiResponse<WindowLogs> = await fetchClient(
      `${base(modelId)}/inference/windows/${windowId}/logs`,
      { signal },
    )
    return res.data
  },

  /**
   * MODEL-SERVE-005-T03. Live error over joined ground truth, plus the
   * coverage that makes it readable. `metrics` is NULL when no lab result
   * has been joined in the range — never zeros, because "the lab has not
   * reported yet" and "an error of zero" must not render the same way.
   */
  async truth(
    modelId: string,
    from: string,
    to: string,
  ): Promise<LiveErrorResult> {
    const query = new URLSearchParams({ from, to })
    const res: ApiResponse<LiveErrorResult> = await fetchClient(
      `${base(modelId)}/inference/truth?${query.toString()}`,
    )
    return res.data
  },
}
