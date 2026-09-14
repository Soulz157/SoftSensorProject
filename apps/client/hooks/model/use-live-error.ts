'use client'

import { useState } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import type { EvalPoint } from '@/lib/model-evaluation'
import {
  inferenceWindowService,
  type LiveErrorCoverage,
  type LiveErrorMetrics,
  type LiveErrorResult,
  type LiveErrorVersion,
  type LiveErrorWindow,
} from '@/services/inference-window'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

const RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

export interface UseLiveErrorResult {
  /** Joined pairs ONLY. Every entry carries an `actual` a lab actually
   *  measured — this hook never fabricates one to fill the shape, which is
   *  why `EvalPoint` could stay non-optional. */
  points: EvalPoint[]
  metrics: LiveErrorMetrics | null
  mixedVersions: boolean
  versions: LiveErrorVersion[]
  /** The target the range was scored against, known even before any lab
   *  sample has joined — `versions` holds only groups that carry pairs. */
  targetColumn: string | null
  coverage: LiveErrorCoverage | null
  windows: LiveErrorWindow[]
  truncated: boolean
  loading: boolean
  /** A transport failure. NOT set for the normal "no lab result has been
   *  joined yet" state — that is `coverage.windowsJoined === 0` with
   *  `metrics === null`, which the panel must say in words. */
  error: string | null
}

const EMPTY: Omit<UseLiveErrorResult, 'loading' | 'error'> = {
  points: [],
  metrics: null,
  mixedVersions: false,
  versions: [],
  targetColumn: null,
  coverage: null,
  windows: [],
  truncated: false,
}

/**
 * MODEL-SERVE-005-T03. The Monitoring tab's Actual-vs-Predict and Residual
 * charts, on REAL joined ground truth — the data that retires the pair of
 * simulated charts this tab carried while T03 was blocked.
 *
 * Built on `useDebouncedAbortableRequest`, the request-lifecycle primitive
 * every other chart hook here shares, with ONE cache key for its ONE
 * endpoint (`use-prediction-monitoring.ts` documents on itself what sharing
 * one key between two endpoints cost last time). `debounceMs: 0` because a
 * range toggle is a discrete click, not a keystroke to debounce.
 *
 * `from`/`to` are computed from `Date.now()` INSIDE the fetcher closure,
 * never in the render body — `Date.now()` is impure and react-hooks/purity
 * refuses it during render. The cache key therefore carries no time
 * component; the shared cache's own TTL already bounds staleness.
 */
export function useLiveError(
  model: AIModel | null,
  range: TimeRange,
): UseLiveErrorResult {
  const [state, setState] =
    useState<Omit<UseLiveErrorResult, 'loading' | 'error'>>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = !!model
  const cacheKey = enabled ? `live-error|truth|${model!.id}|${range}` : null

  useDebouncedAbortableRequest<LiveErrorResult>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: () => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return inferenceWindowService.truth(model!.id, from, to)
    },
    onLoading: () => {
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        const data = result.data
        setState({
          points: data.points.map(p => ({
            timestamp: p.timestamp,
            predicted: p.predicted,
            actual: p.actual,
            residual: p.residual,
          })),
          metrics: data.metrics,
          mixedVersions: data.mixedVersions,
          versions: data.versions,
          targetColumn: data.targetColumn,
          coverage: data.coverage,
          windows: data.windows,
          truncated: data.truncated,
        })
        setError(null)
      } else {
        // A failed read shows NOTHING, never a stale chart relabelled as
        // current — the same rule the drift panel already follows.
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
