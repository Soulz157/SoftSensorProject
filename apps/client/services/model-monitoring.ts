import { fetchClient } from '@/lib/fetcher'

/**
 * MODEL-SERVE-005. Sampled synchronous-/predict logging (T01) and the
 * distribution-drift signal (T02) — read side. Both endpoints live under
 * `authorized/model/:modelId`, matching `model-version`/`model.ts`'s own
 * prefix.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export interface PredictionSeriesPoint {
  timestamp: string
  prediction: number
  features: Record<string, number>
  modelVersionId: string
}

export interface PredictionSeriesResult {
  points: PredictionSeriesPoint[]
  truncated: boolean
}

export type DriftStatus = 'OK' | 'WARN' | 'CRITICAL' | 'UNKNOWN'

export interface DriftColumn {
  column: string
  n: number
  liveMean: number
  liveStd: number
  trainMean: number | null
  trainStd: number | null
  z: number | null
  outOfRangePct: number | null
  status: DriftStatus
  reason?: string
}

export interface DriftReport {
  status: DriftStatus
  columns: DriftColumn[]
  basis: {
    modelVersionId: string
    version: number
    goldArtifactId: string
    goldObjectKey: string
    sampleRequests: number
    from: string
    to: string
  }
}

function base(modelId: string): string {
  return `/api/v1/authorized/model/${modelId}`
}

function rangeQuery(from: string, to: string): string {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

export const modelMonitoringService = {
  /** The logged prediction series for the Monitoring page — one point per
   *  raw logged row, read from the objects apps/serving wrote. `signal` is
   *  threaded through for `useDebouncedAbortableRequest`'s abort-on-
   *  supersede contract (hooks/dataset/internal). */
  predictions: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<PredictionSeriesResult>> =>
    fetchClient(`${base(modelId)}/predictions?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),

  /** Live inputs vs. the PRODUCTION version's own training distribution.
   *  404s when the model has no PRODUCTION version — callers should treat
   *  that as "nothing to show", not an error toast. */
  drift: (
    modelId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<DriftReport>> =>
    fetchClient(`${base(modelId)}/drift?${rangeQuery(from, to)}`, {
      method: 'GET',
      signal,
    }),
}
