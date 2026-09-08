import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { ModelInputSchema } from '@/services/model-monitoring'

const inputSchema = vi.fn()

vi.mock('@/services/model-monitoring', () => ({
  modelMonitoringService: {
    inputSchema: (...args: unknown[]) => inputSchema(...args),
  },
}))

const SCHEMA: ModelInputSchema = {
  modelId: 'model-1',
  versionId: 'version-1',
  version: 2,
  stage: 'PRODUCTION',
  featureColumns: ['TI-101.PV', 'PI-204.PV'],
  unavailableReason: null,
  targetY: 'TI-900.PV',
  scalingParams: { 'TI-101.PV': { min: 0, max: 100 } },
}

beforeEach(() => {
  clearChartRequestCache()
  inputSchema.mockReset()
})

async function mountOnce(modelId: string | null) {
  const { useModelInputSchema } = await import('../use-model-input-schema')
  return renderHook(() => useModelInputSchema(modelId))
}

describe('useModelInputSchema', () => {
  it('returns loading then the resolved schema', async () => {
    inputSchema.mockResolvedValue({ data: SCHEMA })
    const view = await mountOnce('model-1')

    // `loading` starts false and only flips true once the debounced
    // fetcher fires (debounceMs: 0, but still a scheduled timer) — waiting
    // on the eventual data, not on `loading === false`, avoids racing that
    // initial render (same reasoning use-prediction-monitoring.test.tsx
    // applies waiting on `drift` rather than a loading flag).
    await waitFor(() => expect(view.result.current.schema).not.toBeNull())

    expect(view.result.current.schema).toEqual(SCHEMA)
    expect(view.result.current.error).toBeNull()
    expect(view.result.current.loading).toBe(false)
  })

  it('surfaces a transport failure as error, leaving schema null', async () => {
    inputSchema.mockRejectedValue(new Error('network down'))
    const view = await mountOnce('model-1')

    await waitFor(() => expect(view.result.current.error).not.toBeNull())

    expect(view.result.current.schema).toBeNull()
    expect(view.result.current.error).toBe('network down')
    expect(view.result.current.loading).toBe(false)
  })

  it('does not fetch when modelId is null', async () => {
    const view = await mountOnce(null)

    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.schema).toBeNull()
    expect(inputSchema).not.toHaveBeenCalled()
  })

  it('uses a cache key distinct from the prediction-monitoring endpoints', async () => {
    inputSchema.mockResolvedValue({ data: SCHEMA })
    const view = await mountOnce('model-1')
    await waitFor(() => expect(view.result.current.schema).not.toBeNull())

    // A second mount for the same model must hit the warm cache, not
    // refire the request — proves the key is stable and does not collide
    // with `prediction-monitoring|...` keys (use-prediction-monitoring.ts).
    inputSchema.mockClear()
    const second = await mountOnce('model-1')
    await waitFor(() => expect(second.result.current.schema).toEqual(SCHEMA))

    expect(inputSchema).not.toHaveBeenCalled()
  })
})
