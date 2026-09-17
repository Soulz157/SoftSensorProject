'use client'

import { useState } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import {
  inferenceWindowService,
  type ScheduledPoint,
  type ScheduledSeriesResult,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

const RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

/**
 * MODEL-SERVE-011-T12. The SCHEDULED plane's hourly series — one point per
 * SUCCEEDED window, `predictionMean` from that window's own metrics.json.
 *
 * SEPARATE FROM `useLiveError` on purpose, not for convenience. That hook
 * serves JOINED pairs, so a window whose lab target has not reported
 * contributes nothing to it — which on a daily-sampled target is nearly
 * every window, and left the whole scheduled plane invisible on the chart
 * while its predictions sat correctly computed in object storage. This hook
 * asks the narrower question that needs no actual at all.
 *
 * Same shape as every other chart hook here: ONE cache key for ONE endpoint,
 * `debounceMs: 0` (a range toggle is a click, not a keystroke), and
 * `Date.now()` read INSIDE the fetcher closure rather than in the render
 * body, which react-hooks/purity refuses.
 */
export interface UseScheduledSeriesResult {
  points: ScheduledPoint[]
  /** SUCCEEDED windows found in range — the denominator that makes
   *  `missing` readable rather than an unanchored count. */
  windows: number
  /** Windows whose metrics object did not resolve. A gap in the chart, and
   *  stated rather than left to be inferred from a short series. */
  missing: number
  loading: boolean
  /** A transport failure only. An empty range is NOT an error — it is a
   *  model that has not run a scheduled window yet, which the panel says in
   *  words. */
  error: string | null
}

const EMPTY = { points: [] as ScheduledPoint[], windows: 0, missing: 0 }

export function useScheduledSeries(
  model: AIModel | null,
  range: TimeRange,
  refreshKey = 0,
): UseScheduledSeriesResult {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!model
  const cacheKey = enabled
    ? `scheduled-series|${model!.id}|${range}|${refreshKey}`
    : null

  useDebouncedAbortableRequest<ScheduledSeriesResult>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return inferenceWindowService.scheduledSeries(model!.id, from, to, signal)
    },
    onLoading: () => {
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setState({
          points: result.data.points,
          windows: result.data.windows,
          missing: result.data.missing,
        })
      } else {
        // A failed read shows NOTHING, never a stale series relabelled as
        // current — the same rule useLiveError and the drift panel follow.
        setState(EMPTY)
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setState(EMPTY)
      setError(null)
      setLoading(false)
    },
  })

  return { ...state, loading, error }
}
