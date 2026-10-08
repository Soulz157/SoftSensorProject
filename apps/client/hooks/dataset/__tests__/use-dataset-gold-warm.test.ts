import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetGoldWarm } from '../use-dataset-gold-warm'
import { datasetDraftService } from '@/services/dataset-draft'
import { featureRecipeStamp } from '@/lib/feature-engineering'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftFeatureArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwGoldWarmErrorAtom,
  dwFeatureArtifactStampAtom,
  dwModeAtom,
  type DwWizardMode,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    startFeaturesJob: vi.fn(),
    job: vi.fn(),
  },
}))

/**
 * DS-LAKE-022-T04..T07 split: defaults to EDIT mode so every pre-existing
 * test below keeps validating the untouched legacy combined write it was
 * written for, unaffected by `dwModeAtom`'s own default ('create') — see
 * the dedicated "create mode" describe block further down for the
 * reordered path's own coverage.
 */
function renderWithStore(
  draftId: string | null = 'draft-1',
  artifactId: string | null = 'silver-1',
  mode: DwWizardMode = 'edit',
) {
  const store = createStore()
  store.set(dwDraftIdAtom, draftId)
  store.set(dwDraftArtifactIdAtom, artifactId)
  store.set(dwModeAtom, mode)
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

  it('no-ops when there is no draft or source artifact yet — nothing to derive GOLD from, status stays idle', () => {
    const { result } = renderWithStore(null, null)

    act(() => {
      result.current.warm([], null, {})
    })
    vi.runAllTimers()

    expect(datasetDraftService.startFeaturesJob).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('debounces a burst of recipe edits into ONE job for the LATEST recipe, then polls it to SUCCEEDED', async () => {
    mockSucceeds()
    const { result, store } = renderWithStore()

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        null,
        {},
      )
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        ['TI-101'],
        { 'TI-101': 'minmax' },
      )
    })
    // Flips synchronously the instant a valid warm is scheduled, well before
    // the debounce timer or the network call resolve.
    expect(result.current.status).toBe('pending')

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
    expect(result.current.status).toBe('ready')
    expect(store.get(dwFeatureArtifactStampAtom)).toBe(
      featureRecipeStamp({
        features: [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        selectedColumns: ['TI-101'],
        scalers: { 'TI-101': 'minmax' },
        targetY: undefined,
        holdout: null,
      }),
    )
  })

  it('a FAILED job surfaces its OWN error via dwGoldWarmErrorAtom — no longer swallowed, status becomes error', async () => {
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
      result.current.warm([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
    expect(store.get(dwGoldWarmErrorAtom)).toBe(
      "formula 'c0 ^ 2' uses '^' — not supported",
    )
    expect(result.current.status).toBe('error')
  })

  it('the job-START request itself failing (network/4xx, before any job row exists) also surfaces via dwGoldWarmErrorAtom', async () => {
    vi.mocked(datasetDraftService.startFeaturesJob).mockRejectedValue(
      new Error('Draft artifact not found'),
    )
    const { result, store } = renderWithStore()

    act(() => {
      result.current.warm([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.job).not.toHaveBeenCalled()
    expect(store.get(dwGoldWarmErrorAtom)).toBe('Draft artifact not found')
    expect(result.current.status).toBe('error')
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
      result.current.warm([], null, {})
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(store.get(dwGoldWarmErrorAtom)).toBe('first attempt failed')

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
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
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
    })

    // Simulate a transient BRONZE re-fetch mid-debounce: sourceArtifactId
    // flips to null and back. `warmGold`'s identity changes with it
    // (it's a useCallback dep), so `result.current.warm` here is a NEW
    // callback each time — but the guard must run before it touches the
    // shared timer/token refs, or the still-pending warm above gets
    // silently cancelled with nothing scheduled to replace it.
    act(() => {
      store.set(dwDraftArtifactIdAtom, null)
    })
    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
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
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 2 }],
        null,
        {},
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-2')
  })
})

describe('useDatasetGoldWarm — DS-LAKE-022-T04..T07 create-mode split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('CREATE mode sends scale:false and writes the result to dwDraftFeatureArtifactIdAtom, not dwDraftGoldArtifactIdAtom', async () => {
    mockSucceeds('silver-2')
    const { result, store } = renderWithStore('draft-1', 'silver-1', 'create')

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.startFeaturesJob).toHaveBeenCalledWith(
      'draft-1',
      'silver-1',
      expect.objectContaining({ scale: false }),
    )
    expect(store.get(dwDraftFeatureArtifactIdAtom)).toBe('silver-2')
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
  })

  it('DS-LAKE-023: CREATE mode forwards a holdout as the 5th arg into the job payload', async () => {
    mockSucceeds('silver-3')
    const { result } = renderWithStore('draft-1', 'silver-1', 'create')

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
        null,
        { from: '2026-01-16', to: '2026-01-20' },
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(datasetDraftService.startFeaturesJob).toHaveBeenCalledWith(
      'draft-1',
      'silver-1',
      expect.objectContaining({
        holdout: { from: '2026-01-16', to: '2026-01-20' },
      }),
    )
  })

  it('DS-LAKE-023 (edit-mode re-split pass): EDIT mode ALSO forwards a holdout — reverses the old create-mode-only restriction on the holdout specifically', async () => {
    mockSucceeds('gold-3')
    const { result } = renderWithStore('draft-1', 'silver-1', 'edit')

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
        null,
        { from: '2026-01-16', to: '2026-01-20' },
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const [, , body] = vi.mocked(datasetDraftService.startFeaturesJob).mock
      .calls[0]!
    expect(body).toMatchObject({
      holdout: { from: '2026-01-16', to: '2026-01-20' },
    })
    // `scale` stays omitted in edit mode regardless — only the holdout
    // restriction was reversed, not the DS-LAKE-022 stage split.
    expect('scale' in body).toBe(false)
  })

  it('EDIT mode omits scale entirely and writes the result to dwDraftGoldArtifactIdAtom, not dwDraftFeatureArtifactIdAtom', async () => {
    mockSucceeds('gold-1')
    const { result, store } = renderWithStore('draft-1', 'silver-1', 'edit')

    act(() => {
      result.current.warm(
        [{ id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 }],
        null,
        {},
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const [, , body] = vi.mocked(datasetDraftService.startFeaturesJob).mock
      .calls[0]!
    expect('scale' in body).toBe(false)
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBe('gold-1')
    expect(store.get(dwDraftFeatureArtifactIdAtom)).toBeNull()
  })
})
