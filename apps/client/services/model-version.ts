import { fetchClient } from '@/lib/fetcher'
import type { ModelVersionNumber } from '@/lib/model-version-number'

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

/**
 * MODEL-SERVE-016. One row of the Versions tab. `metrics` are the numbers
 * this version FROZE when it was created — not a live measurement, and not
 * the same thing the Evaluation tab computes from applied lab points. Any
 * of the three can be null: legacy rows predate the shape, and a training
 * run can legitimately produce a non-finite R².
 */
export interface ModelVersionRow {
  id: string
  version: number
  stage: 'STAGING' | 'PRODUCTION' | 'ARCHIVED'
  algorithm: string
  retrainStrategy: string | null
  createdAt: string
  archivedAt: string | null
  metrics: {
    rmse: number | null
    r2: number | null
    mae: number | null
  }
}

export const modelVersionService = {
  /**
   * MODEL-SERVE-016-T01. Newest first. Until this shipped nothing could
   * enumerate versions — `promote` below could target one the UI had no way
   * to show.
   */
  async list(modelId: string): Promise<ModelVersionRow[]> {
    const res: ApiResponse<{ versions: ModelVersionRow[] }> = await fetchClient(
      `/api/v1/authorized/model/${modelId}/versions`,
      { method: 'GET' },
    )
    return res.data.versions
  },

  /** `override` is only needed past the r2<=0 promote floor (MODEL-SERVE-
   *  001-T06) — omitted in the common case, where the backend refuses with
   *  a clear reason rather than silently promoting a bad model. */
  async promote(
    modelId: string,
    version: ModelVersionNumber,
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
