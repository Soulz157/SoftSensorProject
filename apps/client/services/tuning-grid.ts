import { fetchClient } from '@/lib/fetcher'

export interface TuningGridResponse {
  algorithm: string
  variants: Array<Record<string, string | number | boolean | null>>
  maxVariantsPerJob: number
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
  get: (algorithm: string): Promise<TuningGridResponse> =>
    fetchClient(
      `/api/v1/authorized/training/tuning-grid/${encodeURIComponent(algorithm)}`,
      { method: 'GET' },
    ),
}
