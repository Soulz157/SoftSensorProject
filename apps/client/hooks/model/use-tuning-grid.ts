'use client'

import { useState } from 'react'
import {
  tuningGridService,
  type TuningGridResponse,
} from '@/services/tuning-grid'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseTuningGridResult {
  grid: TuningGridResponse | null
  loading: boolean
  error: string | null
}

/**
 * MODEL-FLOW-022-T03b. The variants Find Best Parameters will actually
 * search for one algorithm, fetched from the backend's own
 * `apps/backend/src/lib/tuning-grid.ts` rather than a client-side copy of
 * it. Same `useDebouncedAbortableRequest` cache-key shape
 * `useModelInputSchema` uses for its own single-endpoint hook.
 *
 * `enabled` is the CALLER's job, not this hook's — a tab should only fetch
 * while Find Best Parameters is on, so `algorithm` is expected to arrive as
 * `null` otherwise rather than this hook re-deriving that condition.
 */
export function useTuningGrid(algorithm: string | null): UseTuningGridResult {
  const [grid, setGrid] = useState<TuningGridResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!algorithm
  const cacheKey = enabled ? `tuning-grid|${algorithm}` : null

  useDebouncedAbortableRequest<TuningGridResponse>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: () => tuningGridService.get(algorithm!).then(res => res.data),
    onLoading: () => {
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setGrid(result.data)
        setError(null)
      } else {
        setGrid(null)
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setGrid(null)
      setError(null)
      setLoading(false)
    },
  })

  return { grid, loading, error }
}
