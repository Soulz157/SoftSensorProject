import { fetchClient } from '@/lib/fetcher'
import type { DatasetSize, SizeTier } from '@/lib/hyperparam-ranges'

export interface TuningGridResponse {
  algorithm: string
  variants: Array<Record<string, string | number | boolean | null>>
  maxVariantsPerJob: number
  /** MODEL-FLOW-024. The size tier the variants were chosen for; `medium`
   *  when no figure was sent. */
  tier: SizeTier
}

/**
 * MODEL-FLOW-024. Query string for the optional size figures. Empty (not `?`)
 * when neither is known, so an unsized call is byte-for-byte the URL it always
 * was. `null` figures are omitted rather than sent as the string "null".
 */
function sizeQuery(size: DatasetSize | undefined): string {
  const params = new URLSearchParams()
  if (size?.distinctLabelled != null) {
    params.set('distinctLabelled', String(Math.trunc(size.distinctLabelled)))
  }
  if (size?.rows != null) params.set('rows', String(Math.trunc(size.rows)))
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * MODEL-FLOW-022-T03b. Read-only mirror of the backend's
 * `apps/backend/src/lib/tuning-grid.ts` — the variants Find Best Parameters
 * actually searches for one algorithm. Fetched, never re-declared
 * client-side (`use-model-training.ts`'s own no-duplication rule for it).
 */
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
  get: (algorithm: string, size?: DatasetSize): Promise<TuningGridResponse> =>
    fetchClient(
      `/api/v1/authorized/training/tuning-grid/${encodeURIComponent(algorithm)}${sizeQuery(size)}`,
      { method: 'GET' },
    ),
}
