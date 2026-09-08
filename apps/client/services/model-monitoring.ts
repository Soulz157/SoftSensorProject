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

/**
 * The Input Data tab's trained X/Y schema read — the ordered feature list
 * `run_manifest.json` recorded at train time, over `JwtAccessGuard` rather
 * than the machine-only `ServingTokenGuard` the descriptor endpoint sits
 * behind. `featureColumns`/`unavailableReason` are a pair: null/non-null
 * together, never independently — a legacy run with no recorded manifest
 * is a normal state (see `unavailableReason`), not a fetch error.
 */
export interface ModelInputSchema {
  modelId: string
  versionId: string
  version: number
  stage: 'STAGING' | 'PRODUCTION' | 'ARCHIVED'
  /** Ordered exactly as model.predict expects. Null only alongside a set
   *  `unavailableReason`. */
  featureColumns: string[] | null
  unavailableReason: string | null
  /** The trained run's own target — one column, not the wizard's
   *  (possibly multi-select) copy. See `configTargets` for that one. */
  targetY: string
  /** Per-tag fitted scaler params, keyed by tag; null when the sidecar is
   *  unreadable. Feed `inverseScale` one tag's entry at a time. */
  scalingParams: Record<string, Record<string, number>> | null
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

  /** The trained X/Y schema for the Input Data tab — does not vary with a
   *  time range, unlike `predictions`/`drift` above. Never 404s for "no
   *  PRODUCTION version": falls back to the model's latest version, since
   *  Save Model always mints at least one. */
  inputSchema: (
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<ModelInputSchema>> =>
    fetchClient(`${base(modelId)}/input-schema`, {
      method: 'GET',
      signal,
    }),
}
