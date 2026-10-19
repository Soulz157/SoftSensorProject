import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useFineTune } from '../use-fine-tune'
import { modelDraftRunService } from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { mpServerDraftIdAtom, mpTrainStateAtom } from '@/store/model-pipeline'

vi.mock('@/services/model-draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/model-draft')>()
  return {
    ...actual,
    modelDraftRunService: { ...actual.modelDraftRunService, list: vi.fn() },
  }
})
vi.mock('@/hooks/model/use-tuning-variant-counts', () => ({
  useTuningVariantCounts: () => ({}),
}))

const NAV = {
  targetVariables: ['TI-101'],
  trainTestSplit: 80,
  nSplits: undefined,
} as unknown as UsePipelineNavResult

const RUN = {
  id: 'run-1',
  algorithm: 'ridge',
  status: 'SUCCEEDED',
  createdAt: '2026-01-01T00:00:00Z',
  targetY: 'TI-101',
  hyperparameters: { alpha: 3 },
  metrics: { r2: 0.9, rmse: 2, mae: 1 },
  holdoutMetrics: null,
  cvFoldsKey: null,
  predictionsKey: null,
  scoringContainerId: null,
  splitSpec: { method: 'chronological', ratio: 0.8 },
}

function ok(data: unknown[]) {
  return { data, statusCode: 200, message: 'ok', type: 'success' } as never
}

describe('useFineTune — the run list follows training (MODEL-FLOW-035)', () => {
  beforeEach(() => {
    vi.mocked(modelDraftRunService.list).mockReset()
  })

  /**
   * Regression: Step 3 mounts with no run, the user trains, and Fine-tune
   * stayed unavailable (switch disabled) because this hook's run list was
   * fetched once on mount and never again.
   */
  it('becomes available once a training run finishes, without a remount', async () => {
    vi.mocked(modelDraftRunService.list).mockResolvedValue(ok([]))
    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    store.set(mpTrainStateAtom, { status: 'idle', progress: 0 })
    const wrapper = ({ children }: { children: ReactNode }) =>
      Provider({ store, children })
    const { result } = renderHook(
      () =>
        useFineTune({
          nav: NAV,
          training: false,
          datasetSize: { rows: 1000 },
        }),
      { wrapper },
    )
    await waitFor(() => expect(modelDraftRunService.list).toHaveBeenCalled())
    const callsBeforeTraining = vi.mocked(modelDraftRunService.list).mock.calls
      .length
    expect(result.current.available).toBe(false)

    vi.mocked(modelDraftRunService.list).mockResolvedValue(ok([RUN]))
    act(() => store.set(mpTrainStateAtom, { status: 'training', progress: 0 }))
    act(() => store.set(mpTrainStateAtom, { status: 'done', progress: 100 }))

    await waitFor(() => expect(result.current.available).toBe(true))
    expect(
      vi.mocked(modelDraftRunService.list).mock.calls.length,
    ).toBeGreaterThan(callsBeforeTraining)
    expect(result.current.defaultRunId).toBe('run-1')
  })
})
