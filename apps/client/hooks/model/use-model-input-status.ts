'use client'

import { useState } from 'react'
import {
  modelMonitoringService,
  type ModelInputStatus,
} from '@/services/model-monitoring'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseModelInputStatusResult {
  status: ModelInputStatus | null
  loading: boolean
  /** A transport failure. NOT the same thing as PI being unreachable —
   *  that arrives as a normal 200 carrying `status.unavailableReason`, so
   *  the tab can say why the column is blank instead of showing an error. */
  error: string | null
}

/**
 * MODEL-SERVE-001-T15. Live PI quality per feature tag for the Input Data
 * tab, read once per model.
 *
 * SEPARATE from `useModelInputSchema` on purpose, mirroring the backend
 * split: the schema read must never fail the tab, and this one reaches PI.
 * Keeping them apart is what lets a dead historian blank one column instead
 * of the whole feature list.
 *
 * Not keyed to the tab's `TimeRange` toggle either — this is a "right now"
 * snapshot, unlike `usePredictionMonitoring`'s series/drift/psi, which pool
 * a [from, to] window. Its own cache key, so it can never collide with
 * theirs (the collision `use-prediction-monitoring.ts` documents on itself).
 */
export function useModelInputStatus(
  modelId: string | null,
): UseModelInputStatusResult {
  const [status, setStatus] = useState<ModelInputStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!modelId
  const cacheKey = enabled ? `model-input-status|${modelId}` : null

  useDebouncedAbortableRequest<ModelInputStatus>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal =>
      modelMonitoringService
        .inputStatus(modelId!, signal)
        .then(res => res.data),
    onLoading: () => {
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setStatus(result.data)
        setError(null)
      } else {
        setStatus(null)
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setStatus(null)
      setError(null)
      setLoading(false)
    },
  })

  return { status, loading, error }
}
