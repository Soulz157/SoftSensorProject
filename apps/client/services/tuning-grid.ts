import { fetchClient } from '@/lib/fetcher'
import type { DatasetSize, SizeTier } from '@/lib/hyperparam-ranges'

export interface TuningGridResponse {
  algorithm: string
  variants: Array<Record<string, string | number | boolean | null>>
  maxVariantsPerJob: number
  /** MODEL-FLOW-024. The size tier the variants were chosen for; `medium`
   *  when no figure was sent. */
  tier: SizeTier
  /** MODEL-FLOW-024. True when `variants` differ from the general list for this
   *  algorithm — a tier override, a PLS component cap or an LSTM/GRU batch cap.
   *  Not derivable from `tier`: an lstm at a `tiny` tier is not sized by it. */
  sized: boolean
}

/** MODEL-FLOW-038. The default GridSearchCV search space for one algorithm. */
export interface ParamGridResponse {
  algorithm: string
  /** Value list per searched hyperparameter. The base run's own value is NOT
   *  merged in — the client merges its card's values (`effectiveGrid`). */
  paramGrid: Record<string, Array<string | number | boolean | null>>
  tier: SizeTier
  /** The caps the job endpoint enforces; the editor shows them live. */
  maxCombinations: number
  maxValuesPerKey: number
  /** CPUs the trainer may use (the container's quota). */
  cpuBudget: number
  /** True when the trainer fits this algorithm's combinations on several
   *  worker processes, so the time estimate divides the search by them. */
  parallel: boolean
}

/**
 * MODEL-FLOW-024. Query string for the optional size figures and `modelId`.
 * Empty (not `?`) when none is known, so an unsized call is byte-for-byte the
 * URL it always was. `null` figures are omitted rather than sent as the string
 * "null".
 *
 * `modelId` is for a caller with no split stats (the model-detail retrain
 * form): the server resolves the figures that Model's retrain would inherit.
 * A figure sent beside it wins, field by field.
 */
function sizeQuery(
  size: DatasetSize | undefined,
  modelId: string | undefined,
): string {
  const params = new URLSearchParams()
  if (size?.distinctLabelled != null) {
    params.set('distinctLabelled', String(Math.trunc(size.distinctLabelled)))
  }
  if (size?.rows != null) params.set('rows', String(Math.trunc(size.rows)))
  if (size?.features != null && size.features >= 1) {
    params.set('features', String(Math.trunc(size.features)))
  }
  if (modelId) params.set('modelId', modelId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const tuningGridService = {
  /**
   * CORRECTED (MODEL-SERVE-014). This was typed `ApiResponse<
   * TuningGridResponse>` and both callers read `res.data` — but
   * `TuningGridAuthorizedController.get` returns the DTO directly, with no
   * `{statusCode, message, data}` envelope (its declared return type is
   * `TuningGridResponse`, and Nest wraps nothing on its own). So `res.data`
   * was always `undefined`, and reading `.variants` off it threw. The
   * Custom Finetune form surfaced that as "Could not load hyperparameter
   * variants for this algorithm" for an algorithm whose grid exists.
   *
   * Typed against what the endpoint ACTUALLY returns rather than "fixed"
   * by wrapping the backend: nothing else calls this route, and changing a
   * live response shape is the larger change. The same unwrapped-outlier
   * note is on `modelRunLogsService` (services/model-retrain.ts) for
   * `GET /authorized/model/:modelId/runs/:runId`.
   */
  get: (
    algorithm: string,
    size?: DatasetSize,
    modelId?: string,
  ): Promise<TuningGridResponse> =>
    fetchClient(
      `/api/v1/authorized/training/tuning-grid/${encodeURIComponent(algorithm)}${sizeQuery(size, modelId)}`,
      { method: 'GET' },
    ),
}

export const paramGridService = {
  /** MODEL-FLOW-038. Same unwrapped shape as `tuningGridService.get`: the
   *  controller returns the DTO directly, with no `{ data }` envelope. 404 for
   *  lstm/gru, which keep the curated variant search. */
  get: (algorithm: string, size?: DatasetSize): Promise<ParamGridResponse> =>
    fetchClient(
      `/api/v1/authorized/training/param-grid/${encodeURIComponent(algorithm)}${sizeQuery(size, undefined)}`,
      { method: 'GET' },
    ),
}
