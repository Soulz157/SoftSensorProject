import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import type { WindowLogs } from '@/services/inference-window'

const logs = vi.fn()

vi.mock('@/services/inference-window', () => ({
  inferenceWindowService: {
    logs: (...args: unknown[]) => logs(...args),
  },
}))

const SKIPPED_WITH_NO_LINES: WindowLogs = {
  window: {
    id: 'window-1',
    status: 'SKIPPED',
    windowStart: '2026-09-14T10:00:00.000Z',
    windowEnd: '2026-09-14T11:00:00.000Z',
    inputRows: 3,
    missingPct: 0,
    imageDigest: null,
    containerId: null,
    failureReason: 'Only 3 row(s) in window, below INFERENCE_MIN_ROWS',
    attempts: 0,
    startedAt: null,
    finishedAt: '2026-09-14T11:05:00.000Z',
  },
  provenance: {
    deployedAt: '2026-09-13T09:00:00.000Z',
    deployedBy: 'Grace Hopper',
    version: 3,
    stage: 'PRODUCTION',
    promotedAt: '2026-09-13T08:00:00.000Z',
    promotedBy: 'Ada Lovelace',
    promotionOverrideReason: null,
  },
  lines: [],
  truncated: false,
  omittedCount: 0,
}

beforeEach(() => {
  clearChartRequestCache()
  logs.mockReset()
})

async function mount(modelId: string | null, windowId: string | null) {
  const { useWindowLogs } = await import('../use-window-logs')
  return renderHook(() => useWindowLogs(modelId, windowId))
}

describe('useWindowLogs (MODEL-SERVE-001-T10)', () => {
  it('makes no request without both a model and a window', async () => {
    const view = await mount(null, 'latest')
    expect(view.result.current.logs).toBeNull()
    expect(logs).not.toHaveBeenCalled()

    const view2 = await mount('model-1', null)
    expect(view2.result.current.logs).toBeNull()
    expect(logs).not.toHaveBeenCalled()
  })

  it('does NOT set error for a window that simply has no lines', async () => {
    // The contract `useLiveError` states for its own empty case: an absence
    // with a known cause is not a transport failure. A SKIPPED window has
    // zero lines by construction and must not read as broken.
    logs.mockResolvedValue(SKIPPED_WITH_NO_LINES)

    const view = await mount('model-1', 'window-1')

    await waitFor(() => expect(view.result.current.logs).not.toBeNull())
    expect(view.result.current.logs?.lines).toEqual([])
    expect(view.result.current.error).toBeNull()
    expect(view.result.current.logs?.window.status).toBe('SKIPPED')
  })

  it('passes `latest` through so the server resolves the peek’s window', async () => {
    logs.mockResolvedValue(SKIPPED_WITH_NO_LINES)

    await mount('model-1', 'latest')

    await waitFor(() => expect(logs).toHaveBeenCalled())
    expect(logs).toHaveBeenCalledWith('model-1', 'latest', expect.anything())
  })

  it('sets error, and clears logs, on a real transport failure', async () => {
    logs.mockRejectedValue(new Error('network down'))

    const view = await mount('model-1', 'window-1')

    await waitFor(() => expect(view.result.current.error).not.toBeNull())
    expect(view.result.current.logs).toBeNull()
  })

  it('carries the truncation facts through untouched', async () => {
    logs.mockResolvedValue({
      ...SKIPPED_WITH_NO_LINES,
      lines: [
        {
          id: 'log-1',
          level: 'info' as const,
          message: 'Window claimed.',
          createdAt: '2026-09-14T10:00:01.000Z',
        },
      ],
      truncated: true,
      omittedCount: 120,
    })

    const view = await mount('model-1', 'window-1')

    await waitFor(() => expect(view.result.current.logs).not.toBeNull())
    expect(view.result.current.logs?.truncated).toBe(true)
    expect(view.result.current.logs?.omittedCount).toBe(120)
  })
})
