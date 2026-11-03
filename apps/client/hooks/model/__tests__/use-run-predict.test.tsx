import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const runNow = vi.fn()
const windowPrediction = vi.fn()
vi.mock('@/services/inference-window', () => ({
  inferenceWindowService: {
    runNow: (...args: unknown[]) => runNow(...args),
    windowPrediction: (...args: unknown[]) => windowPrediction(...args),
  },
}))

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-1'),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('sonner', () => ({ toast }))

import { useRunPredict } from '../use-run-predict'

const WINDOW_RUN = {
  windowId: 'win-1',
  windowStart: '2026-11-02T05:00:00.000Z',
  windowEnd: '2026-11-02T06:00:00.000Z',
  status: 'PENDING',
  dispatched: true,
  liveVia: 'window' as const,
  live: { ok: false as const, reason: 'scored through its hourly window' },
  message: 'Prediction run queued.',
}

describe('useRunPredict — one button for every algorithm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runNow.mockReset()
    windowPrediction.mockReset()
    Object.values(toast).forEach(fn => fn.mockClear())
  })
  afterEach(() => vi.useRealTimers())

  it('a sequence model waits for its window, then shows the same Predicted toast', async () => {
    runNow.mockResolvedValue(WINDOW_RUN)
    windowPrediction
      .mockResolvedValueOnce({
        status: 'RUNNING',
        pending: true,
        live: { ok: false, reason: 'running' },
      })
      .mockResolvedValueOnce({
        status: 'SUCCEEDED',
        pending: false,
        live: { ok: true, predicted: 20.334, at: '2026-11-02T12:00:00' },
      })
    const onRan = vi.fn()
    const { result } = renderHook(() => useRunPredict(onRan))

    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = result.current.runPredict('model-1')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
      await done
    })

    expect(toast.loading).toHaveBeenCalledTimes(1)
    expect(windowPrediction).toHaveBeenCalledTimes(2)
    expect(windowPrediction).toHaveBeenCalledWith('model-1', 'win-1')
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^Predicted 20\.33 at /),
      expect.objectContaining({ id: 'toast-1' }),
    )
    // The server's "no live reading" placeholder is never shown for it.
    expect(toast.info).not.toHaveBeenCalled()
    expect(onRan).toHaveBeenCalled()
  })

  it('a failed window shows its reason in place of the loading toast', async () => {
    runNow.mockResolvedValue(WINDOW_RUN)
    windowPrediction.mockResolvedValue({
      status: 'FAILED',
      pending: false,
      live: { ok: false, reason: 'source unreachable' },
    })
    const { result } = renderHook(() => useRunPredict(vi.fn()))
    await act(async () => {
      await result.current.runPredict('model-1')
    })
    expect(toast.info).toHaveBeenCalledWith('No reading — source unreachable', {
      id: 'toast-1',
    })
  })

  it('a served model keeps its instant live result and never polls', async () => {
    runNow.mockResolvedValue({
      ...WINDOW_RUN,
      liveVia: 'serving',
      live: { ok: true, predicted: 42.5, at: '2026-11-02T12:59:00' },
    })
    const { result } = renderHook(() => useRunPredict(vi.fn()))
    await act(async () => {
      await result.current.runPredict('model-1')
    })
    expect(windowPrediction).not.toHaveBeenCalled()
    expect(toast.loading).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^Predicted 42\.50 at /),
      expect.any(Object),
    )
  })
})
