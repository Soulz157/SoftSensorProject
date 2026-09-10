import { fetchClient } from '@/lib/fetcher'

/**
 * MODEL-SERVE-001/006. Promote — the ONLY client caller of the promote
 * endpoint that has existed since MODEL-SERVE-001, exercised for the first
 * time by MODEL-SERVE-006's "Save & Deploy" flow (phase-6-deploy.tsx):
 * before this, no UI anywhere could move a version to PRODUCTION.
 */

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

export const modelVersionService = {
  /** `override` is only needed past the r2<=0 promote floor (MODEL-SERVE-
   *  001-T06) — omitted in the common case, where the backend refuses with
   *  a clear reason rather than silently promoting a bad model. */
  async promote(
    modelId: string,
    version: number,
    override?: { reason: string },
  ): Promise<{ id: string; version: number; stage: string }> {
    const res: ApiResponse<{ id: string; version: number; stage: string }> =
      await fetchClient(
        `/api/v1/authorized/model/${modelId}/versions/${version}/promote`,
        {
          method: 'POST',
          body: JSON.stringify(override ? { override } : {}),
        },
      )
    return res.data
  },
}
