import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetDraftHeartbeat } from '../use-dataset-draft-heartbeat'
import { datasetDraftService } from '@/services/dataset-draft'
import { dwDraftIdAtom } from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    touch: vi.fn(),
  },
}))

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

function renderWithStore(draftId: string | null) {
  const store = createStore()
  store.set(dwDraftIdAtom, draftId)
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useDatasetDraftHeartbeat(), { wrapper })
  return { ...rendered, store }
}

describe('useDatasetDraftHeartbeat (DS-LAKE-014-T04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(datasetDraftService.touch).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: { touched: true },
    })
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never calls touch with no draftId', async () => {
    renderWithStore(null)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })

    expect(datasetDraftService.touch).not.toHaveBeenCalled()
  })

  it('beats immediately on mount while visible, then every 60s', async () => {
    renderWithStore('draft-1')
    // The mount-time beat is a direct call, not a timer tick — flush its
    // microtask without advancing the clock, so the freshly-registered
    // setInterval isn't drained early by a timer-flushing helper.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.touch).toHaveBeenCalledWith('draft-1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(3)
  })

  it('stops beating when the tab is backgrounded, and resumes immediately on regaining visibility', async () => {
    renderWithStore('draft-1')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // initial beat
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(1)

    act(() => {
      setVisibility('hidden')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000) // three cadences' worth
    })
    // No new beats while hidden.
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(1)

    await act(async () => {
      setVisibility('visible') // fires an immediate beat, not a wait-for-cadence one
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(2)
  })

  it('clears its timer on unmount — no beat fires after unmount', async () => {
    const { unmount } = renderWithStore('draft-1')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(datasetDraftService.touch).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed beat silently — no throw, no crash', async () => {
    vi.mocked(datasetDraftService.touch).mockRejectedValueOnce(
      new Error('network error'),
    )
    renderWithStore('draft-1')

    await expect(
      act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      }),
    ).resolves.not.toThrow()
  })
})
