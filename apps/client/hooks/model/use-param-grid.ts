'use client'

import { useState } from 'react'
import {
  paramGridService,
  type ParamGridResponse,
} from '@/services/tuning-grid'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'
import type { DatasetSize } from '@/lib/hyperparam-ranges'

interface UseParamGridResult {
  grid: ParamGridResponse | null
  loading: boolean
  error: string | null
}

/**
 * MODEL-FLOW-038. The default GridSearchCV search space for one algorithm,
 * fetched from the backend's own `apps/backend/src/lib/tuning-grid.ts` rather
 * than a client-side copy. Same shape as `useTuningGrid`.
 *
 * `enabled` is the CALLER's job: `algorithm` arrives as `null` while no grid is
 * wanted (Find Best Parameters off, or lstm/gru, which keep the curated
 * variants), so nothing is fetched and nothing 404s.
 */
export function useParamGrid(
  algorithm: string | null,
  size?: DatasetSize,
): UseParamGridResult {
  const [grid, setGrid] = useState<ParamGridResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!algorithm
  // Rows pick the tier and `features` caps PLS components, so both are part of
  // the key: the same algorithm at two sizes serves different grids.
  const cacheKey = enabled
    ? `param-grid|${algorithm}|${size?.rows ?? ''}|${size?.features ?? ''}`
    : null

  useDebouncedAbortableRequest<ParamGridResponse>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: () => paramGridService.get(algorithm!, size),
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
