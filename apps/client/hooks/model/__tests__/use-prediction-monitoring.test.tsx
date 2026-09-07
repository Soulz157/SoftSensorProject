import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { AIModel } from '@/types'

/**
 * Regression coverage for the cache-key collision that produced
 * "Cannot read properties of undefined (reading 'length')" in the Monitoring
 * tab.
 *
 * `usePredictionMonitoring` fires TWO `useDebouncedAbortableRequest` calls
 * against two DIFFERENT endpoints (`/predictions` -> `{points, truncated}`
 * and `/drift` -> `{status, columns, basis}`). The module-level cache
 * (`lib/chart-request-cache.ts`) is one `Map<string, unknown>` keyed only by
 * the caller's `cacheKey` string, and `getCached<T>` is an UNCHECKED cast
 * (`entry.data as T`). So a single shared key means last-writer-wins, and the
 * next reader gets the other endpoint's payload with no type error anywhere —
 * `DriftPanel` then reads `report.columns.length` off a
 * `PredictionSeriesResult` and throws.
 *
 * The Input Data tab made this deterministic rather than a race: it calls
 * this same hook with the same model and the same default '24h' range, so by
 * the time the Monitoring tab mounts, both of its requests hit the warm cache
 * synchronously.
 */

const predictions = vi.fn()
const drift = vi.fn()

vi.mock('@/services/model-monitoring', () => ({
  modelMonitoringService: {
    predictions: (...args: unknown[]) => predictions(...args),
    drift: (...args: unknown[]) => drift(...args),
  },
}))

const PREDICTION_SERIES = {
  points: [
    {
      timestamp: '2026-09-04T10:00:00.000Z',
      prediction: 12.5,
      features: { 'AI001A2.PV': 0.42, 'TI202.PV': 91.3 },
      modelVersionId: 'ver-1',
    },
  ],
  truncated: false,
}

const DRIFT_REPORT = {
  status: 'OK',
  columns: [
    {
      column: 'AI001A2.PV',
      n: 1,
      liveMean: 0.42,
      liveStd: 0,
      trainMean: 0.4,
      trainStd: 0.25,
      z: 0.08,
      outOfRangePct: 0,
      status: 'OK',
    },
  ],
  basis: {
    modelVersionId: 'ver-1',
    version: 1,
    goldArtifactId: 'gold-1',
    goldObjectKey: 'datasets/gold-1/data.parquet',
    sampleRequests: 1,
    from: '2026-09-03T10:00:00.000Z',
    to: '2026-09-04T10:00:00.000Z',
  },
}

const MODEL = { id: 'model-1', name: 'Soft Sensor A' } as unknown as AIModel

beforeEach(() => {
  clearChartRequestCache()
  predictions.mockReset()
  drift.mockReset()
  predictions.mockResolvedValue({ data: PREDICTION_SERIES })
  drift.mockResolvedValue({ data: DRIFT_REPORT })
})

async function mountOnce() {
  const { usePredictionMonitoring } =
    await import('../use-prediction-monitoring')
  const view = renderHook(() => usePredictionMonitoring(MODEL, '24h'))
  await waitFor(() => expect(view.result.current.drift).not.toBeNull())
  return view
}

describe('usePredictionMonitoring — the two requests must not share a cache slot', () => {
  it('gives the drift consumer a drift report, not the prediction series', async () => {
    const first = await mountOnce()

    expect(first.result.current.drift).toEqual(DRIFT_REPORT)
    expect(first.result.current.points).toHaveLength(1)
  })

  it('still returns the right payload to each consumer on a warm cache (the Monitoring tab mounting after Input Data)', async () => {
    // First consumer: the Input Data tab. Warms the cache for this
    // (model, range) pair.
    await mountOnce()

    // Second consumer: the Monitoring tab, same model, same default range —
    // therefore the identical cache key. Both of its requests take the
    // synchronous cache-hit path.
    const second = await mountOnce()

    // The bug: `drift` came back as the PredictionSeriesResult, so
    // `report.columns` was undefined and `DriftPanel` threw on `.length`.
    expect(second.result.current.drift).toEqual(DRIFT_REPORT)
    expect(second.result.current.drift).not.toHaveProperty('points')
    expect(
      (second.result.current.drift as unknown as typeof DRIFT_REPORT).columns,
    ).toHaveLength(1)

    // And the series consumer must not have been handed the drift report.
    expect(second.result.current.points).toHaveLength(1)
    expect(second.result.current.points[0]?.features).toEqual({
      'AI001A2.PV': 0.42,
      'TI202.PV': 91.3,
    })
  })
})
