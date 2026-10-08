'use client'

import { useState } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import {
  inferenceWindowService,
  type ManualPredictionPoint,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

const RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

/**
 * The operator's Run Predict scores in the selected range, drawn as
 * markers on Actual vs Predict beside the scheduler's hourly points.
 *
 * Same shape as `useScheduledSeries`: one cache key for one endpoint,
 * `Date.now()` read inside the fetcher, and a failed read shows nothing
 * rather than a stale series. `refreshKey` is bumped by the page when Run
 * Predict lands (and again after the log-settle delay), so a fresh press
 * appears without touching the range toggle.
 */
export function useManualPredictions(
  model: AIModel | null,
  range: TimeRange,
  refreshKey = 0,
): { points: ManualPredictionPoint[]; loading: boolean } {
  const [points, setPoints] = useState<ManualPredictionPoint[]>([])
  const [loading, setLoading] = useState(false)

  const enabled = !!model
  const cacheKey = enabled
    ? `manual-predictions|${model!.id}|${range}|${refreshKey}`
    : null

  useDebouncedAbortableRequest<{ points: ManualPredictionPoint[] }>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return inferenceWindowService.manualPredictions(
        model!.id,
        from,
        to,
        signal,
      )
    },
    onLoading: () => setLoading(true),
    onSettled: result => {
      setPoints(result.status === 'ready' ? result.data.points : [])
      setLoading(false)
    },
    onIdle: () => {
      setPoints([])
      setLoading(false)
    },
  })

  return { points, loading }
}
