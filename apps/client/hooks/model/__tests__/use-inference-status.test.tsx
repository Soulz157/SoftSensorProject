import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { InferenceStatus } from '@/services/inference-window'

const getStatus = vi.fn()

vi.mock('@/services/inference-window', () => ({
  inferenceWindowService: {
    getStatus: (...args: unknown[]) => getStatus(...args),
  },
}))

const RUNNING: InferenceStatus = {
  enabled: true,
  cadenceMinutes: 60,
  lastSucceededAt: '2026-09-14T10:00:00.000Z',
  lastTerminalAt: '2026-09-14T10:00:00.000Z',
  gapCount: 0,
  staleness: 'OK',
  failing: false,
  lastFailure: null,
  lastSkipped: null,
  deployStatus: 'running',
}

const INITIALIZING: InferenceStatus = {
  ...RUNNING,
  lastSucceededAt: null,
  lastTerminalAt: null,
  staleness: 'STALE',
  deployStatus: 'initializing',
}

beforeEach(() => {
  clearChartRequestCache()
  getStatus.mockReset()
})

async function mountOnce(modelId: string | null) {
  const { useInferenceStatus } = await import('../use-inference-status')
  return renderHook(() => useInferenceStatus(modelId))
}

describe('useInferenceStatus', () => {
  it('returns null status for a null modelId, no request made', async () => {
    const view = await mountOnce(null)
    expect(view.result.current.status).toBeNull()
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('resolves the status on mount', async () => {
    getStatus.mockResolvedValue(RUNNING)
    const view = await mountOnce('model-1')

    await waitFor(() => expect(view.result.current.status).toEqual(RUNNING))
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  // MODEL-SERVE-001-T09. `refetch` must bypass the shared debounce cache —
  // otherwise a Start/Stop-triggered refetch could serve the PRE-mutation
  // value right after the action that was supposed to change it.
  it('refetch issues a real second request, never a cache hit', async () => {
    getStatus.mockResolvedValueOnce(INITIALIZING).mockResolvedValueOnce(RUNNING)
    const view = await mountOnce('model-1')

    await waitFor(() =>
      expect(view.result.current.status).toEqual(INITIALIZING),
    )

    act(() => view.result.current.refetch())

    await waitFor(() => expect(view.result.current.status).toEqual(RUNNING))
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
