'use client'

import { useState } from 'react'
import type { AIModel } from '@/types'
import type { TimeRange } from '@/lib/mock-readings'
import {
  modelMonitoringService,
  type DriftReport,
  type PredictionSeriesResult,
  type PsiReport,
} from '@/services/model-monitoring'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

/** One model prediction at a timestamp — no lab/actual counterpart, matching
 *  `lib/mock-lab-data.ts`'s own `PredPoint` shape for the equivalent mock
 *  path. Ground truth IS joined as of MODEL-SERVE-005-T03, but to scheduled
 *  INFERENCE WINDOWS (`use-live-error.ts`), not to this sampled per-request
 *  stream — a `/predict` call is answered from whatever features the caller
 *  sent, with no window a lab result could be paired against. So this hook
 *  still has no `actual`, and still never fabricates one.
 *
 *  `features`/`modelVersionId` are carried straight through from
 *  `PredictionSeriesPoint` (the raw logged row) for the Input Data tab,
 *  which needs the real X tag names — `LivePredictionChart` ignores both. */
export interface LivePredictionPoint {
  timestamp: string
  predicted: number
  features: Record<string, number>
  modelVersionId: string
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
  /** The window the series was actually fetched over, or null before the
   *  first request. Null is a real state and must not be replaced with a
   *  render-time "now" — see `seriesBounds`' own note below. */
  seriesBounds: { fromMs: number; toMs: number } | null
  /** MODEL-SERVE-008-T06. Which EMPTY state this stream is in when it has
   *  no points: driver off = empty by construction; driver on = nothing has
   *  landed yet. Defaults false, so a model with no schedule row keeps the
   *  original by-construction sentence. */
  livePredictEnabled: boolean
  drift: DriftReport | null
  driftLoading: boolean
  /** The backend's own message on any drift-fetch failure (most commonly a
   *  404 "no PRODUCTION version") — an honest empty state naming why, never
   *  a generic error toast or a stale report. */
  driftUnavailableReason: string | null
  /** MODEL-SERVE-001-T13. Published ALONGSIDE `drift`, never replacing it —
   *  fetched over the SAME `[from, to]` this hook's own `range` prop
   *  already computes for `drift`/`predictions` above. The smallest
   *  available `range` ('24h') already satisfies T13's own "rolling 24h"
   *  sample-floor recommendation; a report reading `INSUFFICIENT_DATA` is
   *  itself the signal to widen the range toggle, not a reason to give
   *  this metric a second, independent time control. */
  psi: PsiReport | null
  psiLoading: boolean
  psiUnavailableReason: string | null
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
  /**
   * MODEL-SERVE-011-T08. Bump to re-read the series — the same `tick`
   * mechanism `use-inference-status.ts` uses, and for the same reason: a
   * mutation landed and ONE read proves it, so this is a key, not a poll.
   * Without it a live point scored by Run Predict was invisible until the
   * user changed the range toggle, because these cache keys carry only the
   * model id and the range.
   */
  refreshKey = 0,
): UsePredictionMonitoringResult {
  const [points, setPoints] = useState<LivePredictionPoint[]>([])
  const [pointsLoading, setPointsLoading] = useState(false)
  const [pointsTruncated, setPointsTruncated] = useState(false)
  /**
   * The window the series was ACTUALLY fetched over, captured inside the
   * fetcher closure below.
   *
   * Exists because `model-monitoring-tab.tsx` needs these bounds to draw the
   * held "Actual" step when there is no prediction series to borrow an axis
   * from, and was computing them with its own `Date.now()` in the render body
   * — which `react-hooks/purity` refuses, and rightly: a value re-read on
   * every incidental re-render is not the range the data came from. Reporting
   * the fetched window instead makes the fallback axis agree with the points
   * beside it.
   */
  const [seriesBounds, setSeriesBounds] = useState<{
    fromMs: number
    toMs: number
  } | null>(null)
  const [livePredictEnabled, setLivePredictEnabled] = useState(false)
  const [drift, setDrift] = useState<DriftReport | null>(null)
  const [driftLoading, setDriftLoading] = useState(false)
  const [driftUnavailableReason, setDriftUnavailableReason] = useState<
    string | null
  >(null)
  const [psi, setPsi] = useState<PsiReport | null>(null)
  const [psiLoading, setPsiLoading] = useState(false)
  const [psiUnavailableReason, setPsiUnavailableReason] = useState<
    string | null
  >(null)

  const enabled = !!model
  // ONE KEY PER ENDPOINT. `lib/chart-request-cache.ts` is a single
  // `Map<string, unknown>` keyed only by this string, and its `getCached<T>`
  // is an unchecked `entry.data as T` cast — so the two requests below
  // sharing one key meant last-writer-wins, and whichever landed second was
  // then handed to BOTH consumers with no type error anywhere. That is how
  // `DriftPanel` came to read `report.columns.length` off a
  // `PredictionSeriesResult` ("Cannot read properties of undefined (reading
  // 'length')"), and how this hook came to spread a `DriftReport`'s missing
  // `.points`. Regression: use-prediction-monitoring.test.tsx.
  const seriesCacheKey = enabled
    ? `prediction-monitoring|predictions|${model!.id}|${range}|${refreshKey}`
    : null
  const driftCacheKey = enabled
    ? `prediction-monitoring|drift|${model!.id}|${range}|${refreshKey}`
    : null
  const psiCacheKey = enabled
    ? `prediction-monitoring|psi|${model!.id}|${range}|${refreshKey}`
    : null

  useDebouncedAbortableRequest<PredictionSeriesResult>({
    enabled,
    cacheKey: seriesCacheKey,
    debounceMs: 0,
    fetcher: signal => {
      // Read here, in the fetcher closure, never in the render body — the
      // rule this file's header already states. Kept so the bounds reported
      // back are the ones this request used.
      const toMs = Date.now()
      const fromMs = toMs - RANGE_MS[range]
      const to = new Date(toMs).toISOString()
      const from = new Date(fromMs).toISOString()
      setSeriesBounds({ fromMs, toMs })
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
            features: p.features,
            modelVersionId: p.modelVersionId,
          })),
        )
        setPointsTruncated(result.data.truncated)
        setLivePredictEnabled(result.data.livePredictEnabled)
      } else {
        setPoints([])
        setPointsTruncated(false)
        setLivePredictEnabled(false)
      }
      setPointsLoading(false)
    },
    onIdle: () => {
      setPoints([])
      setPointsTruncated(false)
      setLivePredictEnabled(false)
      setPointsLoading(false)
    },
  })

  useDebouncedAbortableRequest<DriftReport>({
    enabled,
    cacheKey: driftCacheKey,
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

  useDebouncedAbortableRequest<PsiReport>({
    enabled,
    cacheKey: psiCacheKey,
    debounceMs: 0,
    fetcher: signal => {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - RANGE_MS[range]).toISOString()
      return modelMonitoringService
        .psi(model!.id, from, to, signal)
        .then(res => res.data)
    },
    onLoading: () => {
      setPsi(null)
      setPsiUnavailableReason(null)
      setPsiLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setPsi(result.data)
        setPsiUnavailableReason(null)
      } else {
        setPsi(null)
        setPsiUnavailableReason(result.error)
      }
      setPsiLoading(false)
    },
    onIdle: () => {
      setPsi(null)
      setPsiUnavailableReason(null)
      setPsiLoading(false)
    },
  })

  return {
    points,
    pointsLoading,
    pointsTruncated,
    seriesBounds,
    livePredictEnabled,
    drift,
    driftLoading,
    driftUnavailableReason,
    psi,
    psiLoading,
    psiUnavailableReason,
  }
}
