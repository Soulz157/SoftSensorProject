import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureDraftId, ensureBronzeArtifactId } from '../dataset-draft-bronze'
import { datasetDraftService } from '@/services/dataset-draft'
import type { SavedDataSource } from '@/lib/mock-data-sources'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    create: vi.fn(),
    materialize: vi.fn(),
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

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('dataset-draft-bronze in-flight dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ensureBronzeArtifactId: two concurrent callers for the same draft+tags share one materialize call', async () => {
    const gate = deferred<{ data: { id: string } }>()
    vi.mocked(datasetDraftService.materialize).mockReturnValue(
      gate.promise as never,
    )

    const ctx = {
      workspaceId: 'ws-1',
      selectedSources: [SOURCE],
      customDateRange: { from: '2026-01-01T00:00', to: '2026-01-02T00:00' },
      holdoutRange: null,
      customInterval: null,
      fetchConfig: {
        summaryDuration: '',
        calBasis: 'time',
        summaryType: 'average',
        batchSize: 50,
      } as never,
      period: '1min' as never,
    }

    // Background warm and Step 3.2's lazy ensureBronze both call this for the
    // SAME draft + same tags before either resolves — the exact race that
    // motivated the dedup.
    const call1 = ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101'])
    const call2 = ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101'])

    gate.resolve({ data: { id: 'artifact-1' } })

    const [id1, id2] = await Promise.all([call1, call2])
    expect(id1).toBe('artifact-1')
    expect(id2).toBe('artifact-1')
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(1)
  })

  it('a failed in-flight call propagates to every awaiting caller, then frees the key for a fresh attempt', async () => {
    vi.mocked(datasetDraftService.materialize).mockRejectedValueOnce(
      new Error('source unreachable'),
    )

    const ctx = {
      workspaceId: 'ws-1',
      selectedSources: [SOURCE],
      customDateRange: { from: '2026-01-01T00:00', to: '2026-01-02T00:00' },
      holdoutRange: null,
      customInterval: null,
      fetchConfig: {
        summaryDuration: '',
        calBasis: 'time',
        summaryType: 'average',
        batchSize: 50,
      } as never,
      period: '1min' as never,
    }

    const call1 = ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101'])
    const call2 = ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101'])

    await expect(call1).rejects.toThrow('source unreachable')
    await expect(call2).rejects.toThrow('source unreachable')
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(1)

    // Key is freed after settling — a later, separate attempt tries again
    // fresh rather than being stuck on the failed promise forever.
    vi.mocked(datasetDraftService.materialize).mockResolvedValueOnce({
      data: { id: 'artifact-2' },
    } as never)
    const id = await ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101'])
    expect(id).toBe('artifact-2')
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(2)
  })

  it('ensureDraftId: two concurrent callers for the same workspace share one create call', async () => {
    const gate = deferred<{ data: { id: string } }>()
    vi.mocked(datasetDraftService.create).mockReturnValue(gate.promise as never)

    const call1 = ensureDraftId(
      { workspaceId: 'ws-1', selectedSources: [SOURCE] },
      null,
    )
    const call2 = ensureDraftId(
      { workspaceId: 'ws-1', selectedSources: [SOURCE] },
      null,
    )

    gate.resolve({ data: { id: 'draft-1' } })

    const [id1, id2] = await Promise.all([call1, call2])
    expect(id1).toBe('draft-1')
    expect(id2).toBe('draft-1')
    expect(datasetDraftService.create).toHaveBeenCalledTimes(1)
  })

  it('different tag sets for the same draft do NOT share a key — each materializes independently', async () => {
    vi.mocked(datasetDraftService.materialize)
      .mockResolvedValueOnce({ data: { id: 'artifact-a' } } as never)
      .mockResolvedValueOnce({ data: { id: 'artifact-b' } } as never)

    const ctx = {
      workspaceId: 'ws-1',
      selectedSources: [SOURCE],
      customDateRange: { from: '2026-01-01T00:00', to: '2026-01-02T00:00' },
      holdoutRange: null,
      customInterval: null,
      fetchConfig: {
        summaryDuration: '',
        calBasis: 'time',
        summaryType: 'average',
        batchSize: 50,
      } as never,
      period: '1min' as never,
    }

    const [idA, idB] = await Promise.all([
      ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-101']),
      ensureBronzeArtifactId(ctx, 'draft-1', null, ['TI-102']),
    ])

    expect(idA).toBe('artifact-a')
    expect(idB).toBe('artifact-b')
    expect(datasetDraftService.materialize).toHaveBeenCalledTimes(2)
  })
})

describe('dataset-draft-bronze holdout wiring (DS-LAKE-018-T03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseCtx = {
    workspaceId: 'ws-1',
    selectedSources: [SOURCE],
    customDateRange: { from: '2026-01-01T00:00', to: '2026-01-02T00:00' },
    customInterval: null,
    fetchConfig: {
      summaryDuration: '',
      calBasis: 'time',
      summaryType: 'average',
      batchSize: 50,
    } as never,
    period: '1min' as never,
  }

  it('sends holdout, toPiTime-formatted, when one is selected', async () => {
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-1' },
    } as never)

    await ensureBronzeArtifactId(
      {
        ...baseCtx,
        holdoutRange: { from: '2026-01-01T12:00', to: '2026-01-01T18:00' },
      },
      'draft-1',
      null,
      ['TI-101'],
    )

    const call = vi.mocked(datasetDraftService.materialize).mock.calls[0]!
    expect(call[1].holdout).toEqual({
      from: '2026-01-01 12:00:00',
      to: '2026-01-01 18:00:00',
    })
  })

  it('omits holdout entirely when none is selected — behaves exactly as today', async () => {
    vi.mocked(datasetDraftService.materialize).mockResolvedValue({
      data: { id: 'artifact-2' },
    } as never)

    await ensureBronzeArtifactId(
      { ...baseCtx, holdoutRange: null },
      'draft-1',
      null,
      ['TI-102'],
    )

    const call = vi.mocked(datasetDraftService.materialize).mock.calls[0]!
    expect(call[1]).not.toHaveProperty('holdout')
  })
})
