'use client'

import { useState } from 'react'
import {
  inferenceWindowService,
  type InferenceWindow,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseInferenceWindowsResult {
  windows: InferenceWindow[]
  loading: boolean
  /** A transport failure only — an empty `windows` is a valid answer for a
   *  model whose schedule has never run, not an error. */
  error: string | null
  refetch: () => void
}

/**
 * MODEL-SERVE-001-T10. The window list behind `models/[id]`'s Logs tab —
 * the reader picks a window, `useWindowLogs` fetches that window's lines.
 *
 * ORDERING IS THE SERVER'S, AND IT IS `windowStart desc`. That is NOT
 * execution order: MODEL-SERVE-006-T02's `dispatch_order_2026_09_14`
 * changed the scheduler's claim to `desc` so live windows beat backfill,
 * which means a draining backfill executes out of `windowStart` sequence.
 * Anything rendering this list must label it as window time, never as the
 * order things ran.
 *
 * No poll, for the same reason `useWindowLogs` has none.
 */
export function useInferenceWindows(
  modelId: string | null,
): UseInferenceWindowsResult {
  const [windows, setWindows] = useState<InferenceWindow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const enabled = !!modelId
  const cacheKey = enabled ? `inference-windows|${modelId}|${tick}` : null

  useDebouncedAbortableRequest<InferenceWindow[]>({
    enabled,
    cacheKey,
    debounceMs: 0,
    skipCache: true,
    fetcher: () => inferenceWindowService.listWindows(modelId as string),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setWindows(result.data)
        setError(null)
      } else {
        setWindows([])
        setError(result.error)
      }
    },
    onIdle: () => {
      setWindows([])
      setLoading(false)
      setError(null)
    },
  })

  return {
    windows,
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
