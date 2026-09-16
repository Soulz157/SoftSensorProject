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
  // MODEL-SERVE-001-T26: OFF carries no reason — it means deliberately not
  // watching, never a fault.
  health: {
    status: 'OFF',
    reason: null,
    // T29: no stuck instruments to report.
    frozenColumns: [],
    thresholds: null,
  },
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

  /**
   * MODEL-SERVE-001-T19. A first-load transport failure must surface as
   * `error` while `status` stays `null` (not silently retained as some
   * OTHER value there was never a successful read to produce) — the
   * consumer this hook exists for (models/[id]/page.tsx) gates BOTH
   * Start and Stop on `status !== null`, so a caller that drops `error`
   * on the floor here leaves both buttons disabled forever with nothing
   * on screen explaining why, indistinguishable from a press that did
   * nothing.
   */
  it('surfaces a transport failure as `error` and leaves `status` null', async () => {
    getStatus.mockRejectedValue(new Error('Network request failed'))
    const view = await mountOnce('model-1')

    await waitFor(() =>
      expect(view.result.current.error).toBe('Network request failed'),
    )
    expect(view.result.current.status).toBeNull()
    expect(view.result.current.loading).toBe(false)
  })

  it('clears a prior error once a subsequent refetch succeeds', async () => {
    getStatus
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(RUNNING)
    const view = await mountOnce('model-1')

    await waitFor(() =>
      expect(view.result.current.error).toBe('Network request failed'),
    )

    act(() => view.result.current.refetch())

    await waitFor(() => expect(view.result.current.status).toEqual(RUNNING))
    expect(view.result.current.error).toBeNull()
  })
})
