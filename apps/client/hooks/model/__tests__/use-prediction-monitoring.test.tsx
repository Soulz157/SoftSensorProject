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
 * and `/psi` -> `{status, columns, basis}`). The module-level cache
 * (`lib/chart-request-cache.ts`) is one `Map<string, unknown>` keyed only by
 * the caller's `cacheKey` string, and `getCached<T>` is an UNCHECKED cast
 * (`entry.data as T`). So a single shared key means last-writer-wins, and the
 * next reader gets the other endpoint's payload with no type error anywhere.
 * (Found originally on the since-removed z-score `/drift` request; the PSI
 * request carries the same risk, so the regression now pins that one.)
 *
 * The Input Data tab made this deterministic rather than a race: it calls
 * this same hook with the same model and the same default '24h' range, so by
 * the time the Monitoring tab mounts, both of its requests hit the warm cache
 * synchronously.
 */

const predictions = vi.fn()
const psi = vi.fn()

vi.mock('@/services/model-monitoring', () => ({
  modelMonitoringService: {
    predictions: (...args: unknown[]) => predictions(...args),
    psi: (...args: unknown[]) => psi(...args),
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

const PSI_REPORT = {
  status: 'OK',
  columns: [
    {
      column: 'AI001A2.PV',
      liveTotal: 400,
      psi: 0.02,
      outOfRangePct: 0,
      status: 'OK',
      bins: null,
    },
  ],
  basis: {
    plane: 'predict',
    modelVersionId: 'ver-1',
    version: 1,
    goldArtifactId: 'gold-1',
    goldObjectKey: 'datasets/gold-1/data.parquet',
    sampleRequests: 1,
    histogramRequests: 1,
    from: '2026-09-03T10:00:00.000Z',
    to: '2026-09-04T10:00:00.000Z',
    thresholds: { warn: 0.1, critical: 0.25, minSamplesPerBin: 20, outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20 },
    epsilon: 1e-4,
  },
}

const MODEL = { id: 'model-1', name: 'Soft Sensor A' } as unknown as AIModel

beforeEach(() => {
  clearChartRequestCache()
  predictions.mockReset()
  psi.mockReset()
  predictions.mockResolvedValue({ data: PREDICTION_SERIES })
  psi.mockResolvedValue({ data: PSI_REPORT })
})

async function mountOnce() {
  const { usePredictionMonitoring } =
    await import('../use-prediction-monitoring')
  const view = renderHook(() => usePredictionMonitoring(MODEL, '24h'))
  await waitFor(() => expect(view.result.current.psi).not.toBeNull())
  return view
}

describe('usePredictionMonitoring — the two requests must not share a cache slot', () => {
  it('gives the PSI consumer a PSI report, not the prediction series', async () => {
    const first = await mountOnce()

    expect(first.result.current.psi).toEqual(PSI_REPORT)
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

    expect(second.result.current.psi).toEqual(PSI_REPORT)
    expect(second.result.current.psi).not.toHaveProperty('points')
    expect(second.result.current.psi?.columns).toHaveLength(1)

    // And the series consumer must not have been handed the PSI report.
    expect(second.result.current.points).toHaveLength(1)
    expect(second.result.current.points[0]?.features).toEqual({
      'AI001A2.PV': 0.42,
      'TI202.PV': 91.3,
    })
  })
})
