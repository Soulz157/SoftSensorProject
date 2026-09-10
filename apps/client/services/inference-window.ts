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
}

export interface InferenceStatus {
  enabled: boolean
  cadenceMinutes: number | null
  lastSucceededAt: string | null
  lastTerminalAt: string | null
  gapCount: number
  staleness: 'OK' | 'STALE'
  failing: boolean
  deployStatus: 'stopped' | 'running' | 'error' | 'initializing'
}

export interface InferenceWindow {
  id: string
  modelId: string
  modelVersionId: string
  windowStart: string
  windowEnd: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
  inputRows: number | null
  missingPct: number | null
  failureReason: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
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

  async getStatus(modelId: string): Promise<InferenceStatus> {
    const res: ApiResponse<InferenceStatus> = await fetchClient(
      `${base(modelId)}/inference/status`,
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
}
