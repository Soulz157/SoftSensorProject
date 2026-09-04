'use client'

import { useState } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import {
  modelMonitoringService,
  type DriftReport,
  type PredictionSeriesResult,
} from '@/services/model-monitoring'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

/** One model prediction at a timestamp — no lab/actual counterpart, matching
 *  `lib/mock-lab-data.ts`'s own `PredPoint` shape for the equivalent mock
 *  path. Ground truth is not joined yet (MODEL-SERVE-005-T03, blocked — see
 *  the ledger for what blocks it); this hook never fabricates one. */
export interface LivePredictionPoint {
  timestamp: string
  predicted: number
}

const RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

interface UsePredictionMonitoringResult {
  points: LivePredictionPoint[]
  pointsLoading: boolean
  pointsTruncated: boolean
  drift: DriftReport | null
  driftLoading: boolean
  /** The backend's own message on any drift-fetch failure (most commonly a
   *  404 "no PRODUCTION version") — an honest empty state naming why, never
   *  a generic error toast or a stale report. */
  driftUnavailableReason: string | null
}

/**
 * MODEL-SERVE-005. Real data for the Monitoring page's "Live Predictions"
 * and "Distribution Drift" panels — the sampled synchronous-/predict
 * stream and the drift signal built on it. Deliberately SEPARATE from
 * `useMonitoringData` (the existing Actual-vs-Predict/Residual charts):
 * those charts and their SD-band/residual math require ground truth, which
 * this system does not have yet (T03 is blocked) — fabricating an `actual`
 * value to satisfy that shape would be exactly the kind of plausible wrong
 * answer this ledger's own definition of done forbids. This hook only ever
 * returns what was actually predicted and actually logged.
 *
 * Built on `useDebouncedAbortableRequest` (hooks/dataset/internal), the
 * same request-lifecycle primitive the Data Studio chart hooks already
 * share — debounce/abort-on-supersede/cache for free, and every `setState`
 * call happens inside its `onLoading`/`onSettled`/`onIdle` callbacks
 * (invoked from that hook's own async/timer body), never synchronously in
 * this hook's own effect — `debounceMs: 0` because a range toggle is a
 * discrete click, not a keystroke to debounce.
 *
 * `to`/`from` are computed from `Date.now()` INSIDE each `fetcher` closure,
 * not in this hook's render body or in an effect — `Date.now()` is an
 * impure call React's purity rule (react-hooks/purity) refuses during
 * render, and `fetcher` only ever runs from `useDebouncedAbortableRequest`'s
 * own async timer body, well outside render. `cacheKey` therefore carries
 * no time component; the shared request cache's own 30s TTL
 * (chart-request-cache.ts) already bounds how stale a cache hit's window
 * can be, so a second time-bucket here would just duplicate that bound.
 */
export function usePredictionMonitoring(
  model: AIModel | null,
  range: TimeRange,
): UsePredictionMonitoringResult {
  const [points, setPoints] = useState<LivePredictionPoint[]>([])
  const [pointsLoading, setPointsLoading] = useState(false)
  const [pointsTruncated, setPointsTruncated] = useState(false)
  const [drift, setDrift] = useState<DriftReport | null>(null)
  const [driftLoading, setDriftLoading] = useState(false)
  const [driftUnavailableReason, setDriftUnavailableReason] = useState<
    string | null
  >(null)

  const enabled = !!model
  const cacheKey = enabled
    ? `prediction-monitoring|${model!.id}|${range}`
    : null

  useDebouncedAbortableRequest<PredictionSeriesResult>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return modelMonitoringService
        .predictions(model!.id, from, to, signal)
        .then(res => res.data)
    },
    onLoading: () => setPointsLoading(true),
    onSettled: result => {
      if (result.status === 'ready') {
        const sorted = [...result.data.points].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        )
        setPoints(
          sorted.map(p => ({
            timestamp: p.timestamp,
            predicted: p.prediction,
          })),
        )
        setPointsTruncated(result.data.truncated)
      } else {
        setPoints([])
        setPointsTruncated(false)
      }
      setPointsLoading(false)
    },
    onIdle: () => {
      setPoints([])
      setPointsTruncated(false)
      setPointsLoading(false)
    },
  })

  useDebouncedAbortableRequest<DriftReport>({
    enabled,
    cacheKey,
    debounceMs: 0,
    fetcher: signal => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return modelMonitoringService
        .drift(model!.id, from, to, signal)
        .then(res => res.data)
    },
    onLoading: () => {
      setDrift(null)
      setDriftUnavailableReason(null)
      setDriftLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setDrift(result.data)
        setDriftUnavailableReason(null)
      } else {
        setDrift(null)
        setDriftUnavailableReason(result.error)
      }
      setDriftLoading(false)
    },
    onIdle: () => {
      setDrift(null)
      setDriftUnavailableReason(null)
      setDriftLoading(false)
    },
  })

  return {
    points,
    pointsLoading,
    pointsTruncated,
    drift,
    driftLoading,
    driftUnavailableReason,
  }
}
