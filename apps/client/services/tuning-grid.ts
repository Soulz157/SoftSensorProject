import { fetchClient } from '@/lib/fetcher'

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

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
  get: (algorithm: string): Promise<ApiResponse<TuningGridResponse>> =>
    fetchClient(
      `/api/v1/authorized/training/tuning-grid/${encodeURIComponent(algorithm)}`,
      { method: 'GET' },
    ),
}
