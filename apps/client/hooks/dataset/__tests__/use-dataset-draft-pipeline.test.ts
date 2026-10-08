import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetDraftPipeline } from '../use-dataset-draft-pipeline'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwCustomDateRangeAtom,
  dwModeAtom,
  dwDraftIdAtom,
  type DwWizardMode,
} from '@/store/dataset-studio'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { CleaningStep } from '@/lib/preprocessing'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    create: vi.fn(),
    materialize: vi.fn(),
    preview: vi.fn(),
    clean: vi.fn(),
    job: vi.fn(),
    cancelJob: vi.fn(),
    retryJob: vi.fn(),
  },
}))

const SOURCE: SavedDataSource = {
  id: 'src-1',
  name: 'PI Prod',
  type: 'aveva',
  host: 'pi.example.com',
  username: 'svc',
  dbName: 'PIServer',
  status: 'connected',
} as SavedDataSource

const STEPS: CleaningStep[] = [
  { uid: 's1', category: 'missing', method: 'drop' },
]

function renderWithStore(opts: { mode?: DwWizardMode; draftId?: string } = {}) {
  const store = createStore()
  store.set(dwWorkspaceIdAtom, 'ws-1')
  store.set(dwSelectedSourcesAtom, [SOURCE])
  store.set(dwCustomDateRangeAtom, {
    from: '2026-01-01T00:00',
    to: '2026-01-02T00:00',
  })
  if (opts.mode) store.set(dwModeAtom, opts.mode)
  if (opts.draftId) store.set(dwDraftIdAtom, opts.draftId)
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  return { store, ...renderHook(() => useDatasetDraftPipeline(), { wrapper }) }
}

describe('useDatasetDraftPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a draft, materializes bronze, starts the clean job, and syncs on success', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)
    vi.mocked(datasetDraftService.clean).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job).mockResolvedValue({
      data: {
        status: 'SUCCEEDED',
        resultArtifactId: 'artifact-2',
        error: null,
      },
    } as never)

    const { result } = renderWithStore()

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })

    expect(datasetDraftService.create).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sourceIds: ['src-1'],
    })
    expect(datasetDraftService.materialize).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ sourceId: 'src-1', tags: ['TI-101'] }),
    )
    expect(datasetDraftService.clean).toHaveBeenCalledWith(
      'draft-1',
      'artifact-1',
      {
        operations: [{ type: 'drop', tags: ['TI-101'] }],
      },
    )
    await waitFor(() => expect(result.current.syncState.status).toBe('synced'))
  })

  it('never throws out of applyClean — a materialize failure lands in syncState', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockRejectedValue(
      new Error('source unreachable'),
    )

    const { result } = renderWithStore()

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })

    expect(result.current.syncState.status).toBe('error')
    expect(result.current.syncState.error).toContain('source unreachable')
    expect(datasetDraftService.clean).not.toHaveBeenCalled()
  })

  it('reuses an already-materialized artifact rather than re-fetching from source', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)
    vi.mocked(datasetDraftService.clean).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: null, error: null },
    } as never)

    const { result } = renderWithStore()

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })
    await waitFor(() => expect(result.current.syncState.status).toBe('synced'))

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })

    // Second Apply must NOT re-create a draft or re-materialize — both ids
    // are already known from the first run.
    expect(datasetDraftService.create).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(1)
    expect(datasetDraftService.clean).toHaveBeenCalledTimes(2)
  })
})

describe('useDatasetDraftPipeline — requestFinalPreview (T01 hybrid)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('debounces: rapid calls before the delay elapses fire exactly one preview request', async () => {
    vi.mocked(datasetDraftService.create).mockResolvedValue({
      data: { id: 'draft-1' },
    } as never)
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)
    vi.mocked(datasetDraftService.preview).mockResolvedValue({
      data: {
        before: { row_count: 10, missing_pct: 5 },
        after: { row_count: 9, missing_pct: 0 },
        warnings: [],
      },
    } as never)

    const { result } = renderWithStore()

    act(() => {
      result.current.requestFinalPreview(['TI-101'], STEPS)
      result.current.requestFinalPreview(['TI-101'], STEPS)
      result.current.requestFinalPreview(['TI-101'], STEPS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(datasetDraftService.preview).toHaveBeenCalledTimes(1)
    expect(result.current.finalPreview.status).toBe('ready')
  })

  it('resets to idle when called with an empty pipeline, without a network call', async () => {
    const { result } = renderWithStore()

    act(() => {
      result.current.requestFinalPreview([], [])
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(datasetDraftService.preview).not.toHaveBeenCalled()
    expect(result.current.finalPreview.status).toBe('idle')
  })
})

describe('DS-LAKE-024-T03: ensureDraft refuses to mint a create-mode draft in edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never calls datasetDraftService.create — surfaces a syncState error instead', async () => {
    const { result } = renderWithStore({ mode: 'edit' })

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })

    expect(datasetDraftService.create).not.toHaveBeenCalled()
    expect(datasetDraftService.materialize).not.toHaveBeenCalled()
    expect(result.current.syncState.status).toBe('error')
    expect(result.current.syncState.error).toMatch(/not ready to edit/i)
  })

  it('proceeds normally once the edit draft has already resolved (dwDraftIdAtom set)', async () => {
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'shared-bronze-1' },
    } as never)
    vi.mocked(datasetDraftService.clean).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: null, error: null },
    } as never)

    const { result } = renderWithStore({
      mode: 'edit',
      draftId: 'edit-draft-1',
    })

    await act(async () => {
      await result.current.applyClean(['TI-101'], STEPS)
    })

    // The already-resolved id is used as-is — no create call, and the
    // materialize/clean calls are scoped to the SAME draft id the edit
    // hydration hook resolved, not a freshly minted one.
    expect(datasetDraftService.create).not.toHaveBeenCalled()
    expect(datasetDraftService.materialize).toHaveBeenCalledWith(
      'edit-draft-1',
      expect.anything(),
    )
    await waitFor(() => expect(result.current.syncState.status).toBe('synced'))
  })
})
