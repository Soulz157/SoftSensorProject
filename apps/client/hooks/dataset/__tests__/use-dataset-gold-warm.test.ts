import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetGoldWarm } from '../use-dataset-gold-warm'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwGoldWarmErrorAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    startFeaturesJob: vi.fn(),
    job: vi.fn(),
  },
}))

function renderWithStore(
  draftId: string | null = 'draft-1',
  artifactId: string | null = 'silver-1',
) {
  const store = createStore()
  store.set(dwDraftIdAtom, draftId)
  store.set(dwDraftArtifactIdAtom, artifactId)
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useDatasetGoldWarm(), { wrapper })
  return { ...rendered, store }
}

/** Default: the job's own poll settles SUCCEEDED on the first check, so no
 * extra fake-timer advance is needed for the poll loop itself — only the
 * outer 800ms debounce needs `runAllTimersAsync`, same as
 * use-dataset-draft-pipeline.test.ts's own clean-job mocks. */
function mockSucceeds(resultArtifactId = 'gold-1') {
  vi.mocked(datasetDraftService.startFeaturesJob).mockResolvedValue({
    data: { jobId: 'job-1', status: 'QUEUED' },
  } as never)
  vi.mocked(datasetDraftService.job).mockResolvedValue({
    data: { status: 'SUCCEEDED', resultArtifactId, error: null },
  } as never)
}

describe('useDatasetGoldWarm (DS-LAKE-006-T06, async job since DS-LAKE-006-T06 reversal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('no-ops when there is no draft or source artifact yet — nothing to derive GOLD from', () => {
    const { result } = renderWithStore(null, null)

    act(() => {
      result.current([], null, {})
    })
    vi.runAllTimers()

    expect(datasetDraftService.startFeaturesJob).not.toHaveBeenCalled()
  })

  it('debounces a burst of recipe edits into ONE job for the LATEST recipe, then polls it to SUCCEEDED', async () => {
    mockSucceeds()
    const { result, store } = renderWithStore()

    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }], null, {})
      result.current(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        ['TI-101'],
        { 'TI-101': 'minmax' },
      )
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.startFeaturesJob).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.startFeaturesJob).toHaveBeenCalledWith(
      'draft-1',
      'silver-1',
      {
        features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        selectedColumns: ['TI-101'],
        scalers: { 'TI-101': 'minmax' },
      },
    )
    expect(datasetDraftService.job).toHaveBeenCalledWith('draft-1', 'job-1')
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-1')
  })

  it('a FAILED job surfaces its OWN error via dwGoldWarmErrorAtom — no longer swallowed', async () => {
    vi.mocked(datasetDraftService.startFeaturesJob).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job).mockResolvedValue({
      data: {
        status: 'FAILED',
        resultArtifactId: null,
        error: "formula 'c0 ^ 2' uses '^' — not supported",
      },
    } as never)
    const { result, store } = renderWithStore()

    act(() => {
      result.current([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
    expect(store.get(dwGoldWarmErrorAtom)).toBe(
      "formula 'c0 ^ 2' uses '^' — not supported",
    )
  })

  it('the job-START request itself failing (network/4xx, before any job row exists) also surfaces via dwGoldWarmErrorAtom', async () => {
    vi.mocked(datasetDraftService.startFeaturesJob).mockRejectedValue(
      new Error('Draft artifact not found'),
    )
    const { result, store } = renderWithStore()

    act(() => {
      result.current([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.job).not.toHaveBeenCalled()
    expect(store.get(dwGoldWarmErrorAtom)).toBe('Draft artifact not found')
  })

  it('a fresh attempt clears a stale error, and success clears it too', async () => {
    vi.mocked(datasetDraftService.startFeaturesJob).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job)
      .mockResolvedValueOnce({
        data: {
          status: 'FAILED',
          resultArtifactId: null,
          error: 'first attempt failed',
        },
      } as never)
      .mockResolvedValueOnce({
        data: { status: 'SUCCEEDED', resultArtifactId: 'gold-1', error: null },
      } as never)
    const { result, store } = renderWithStore()

    act(() => {
      result.current([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(store.get(dwGoldWarmErrorAtom)).toBe('first attempt failed')

    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
    })
    // Cleared synchronously the moment a new attempt is scheduled, before
    // the request even resolves.
    expect(store.get(dwGoldWarmErrorAtom)).toBeNull()

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-1')
    expect(store.get(dwGoldWarmErrorAtom)).toBeNull()
  })

  it('a transient null artifact id does not cancel an already-scheduled warm (guard runs before cancel)', async () => {
    mockSucceeds()
    const { result, store } = renderWithStore()

    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
    })

    // Simulate a transient BRONZE re-fetch mid-debounce: sourceArtifactId
    // flips to null and back. `warmGold`'s identity changes with it
    // (it's a useCallback dep), so `result.current` here is a NEW callback
    // each time — but the guard must run before it touches the shared
    // timer/token refs, or the still-pending warm above gets silently
    // cancelled with nothing scheduled to replace it.
    act(() => {
      store.set(dwDraftArtifactIdAtom, null)
    })
    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
    })
    act(() => {
      store.set(dwDraftArtifactIdAtom, 'silver-1')
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.startFeaturesJob).toHaveBeenCalledTimes(1)
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-1')
  })

  it('a newer edit superseding an in-flight poll does not let the stale job overwrite state', async () => {
    // First attempt's job never resolves during this test (simulates still
    // polling); the SECOND attempt (a newer token) must win regardless.
    vi.mocked(datasetDraftService.startFeaturesJob)
      .mockResolvedValueOnce({
        data: { jobId: 'job-stale', status: 'QUEUED' },
      } as never)
      .mockResolvedValueOnce({
        data: { jobId: 'job-2', status: 'QUEUED' },
      } as never)
    vi.mocked(datasetDraftService.job).mockImplementation((_draftId, jobId) =>
      Promise.resolve({
        data:
          jobId === 'job-2'
            ? { status: 'SUCCEEDED', resultArtifactId: 'gold-2', error: null }
            : {
                status: 'SUCCEEDED',
                resultArtifactId: 'gold-stale',
                error: null,
              },
      } as never),
    )
    const { result, store } = renderWithStore()

    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }], null, {})
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    act(() => {
      result.current([{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-2')
  })
})
