import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useModelTraining } from '../use-model-training'
import {
  modelDraftRunService,
  modelDraftCandidateJobService,
} from '@/services/model-draft'
import {
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpTargetVariableAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  mpCandidateJobIdAtom,
  mpTrainStateAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'

vi.mock('@/services/model-draft', () => ({
  modelDraftRunService: {
    create: vi.fn(),
    get: vi.fn(),
  },
  modelDraftCandidateJobService: {
    create: vi.fn(),
    get: vi.fn(),
  },
  modelDraftService: {
    get: vi.fn(),
  },
}))

const DATASET: SavedDataset = {
  id: 'ds-1',
  name: 'Dataset 1',
  workspaceId: 'ws-1',
  currentArtifactId: 'art-1',
  currentArtifactType: 'FINAL',
} as SavedDataset

function renderTraining(
  configure?: (store: ReturnType<typeof createStore>) => void,
) {
  const store = createStore()
  store.set(mpSelectedDatasetAtom, DATASET)
  store.set(mpTargetVariableAtom, ['TI-101'])
  store.set(mpServerDraftIdAtom, 'draft-1')
  // Applied BEFORE the hook mounts, not after — `useModelTraining`'s `run`
  // callback closes over the atom values from its most recent render, and
  // a bare `store.set` after `renderHook` schedules a re-render that has
  // not necessarily flushed by the time a test reads `result.current`.
  configure?.(store)
  const ensureDraftId = vi.fn().mockResolvedValue('draft-1')
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useModelTraining({ ensureDraftId }), {
    wrapper,
  })
  return { ...rendered, store, ensureDraftId }
}

describe('useModelTraining — MODEL-FLOW-013-T07/T11', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refuses Find Best Parameters even if the UI-disable was bypassed by stale state', async () => {
    const { result, store } = renderTraining(s =>
      s.set(mpFindBestParamsAtom, true),
    )

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('error')
    expect(modelDraftRunService.create).not.toHaveBeenCalled()
    expect(modelDraftCandidateJobService.create).not.toHaveBeenCalled()
  })

  it('refuses a sweep with fewer than 2 algorithms', async () => {
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpAlgorithmsAtom, ['ols'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('error')
    expect(modelDraftCandidateJobService.create).not.toHaveBeenCalled()
  })

  it('creates an ALGORITHM_SWEEP candidate job with one candidate per selected algorithm', async () => {
    vi.mocked(modelDraftCandidateJobService.create).mockResolvedValue({
      statusCode: 201,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'job-1' } as never,
    })
    vi.mocked(modelDraftCandidateJobService.get).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: {
        id: 'job-1',
        status: 'RUNNING',
        completedRuns: 0,
        totalRuns: 2,
        candidates: [],
      } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        kind: 'ALGORITHM_SWEEP',
        targetY: 'TI-101',
        candidates: [
          { algorithm: 'ols', hyperparameters: { fit_intercept: true } },
          { algorithm: 'ridge', hyperparameters: { alpha: 1.0 } },
        ],
      }),
    )
    expect(store.get(mpTrainStateAtom).status).toBe('training')
  })

  it('on a successful sweep, sets mpTrainingResultAtom from the WINNING candidate and records the job id', async () => {
    vi.mocked(modelDraftCandidateJobService.create).mockResolvedValue({
      statusCode: 201,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'job-1' } as never,
    })
    vi.mocked(modelDraftCandidateJobService.get).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: {
        id: 'job-1',
        status: 'SUCCEEDED',
        completedRuns: 2,
        totalRuns: 2,
        bestRunId: 'run-2',
        finishedAt: '2026-08-28T00:00:00.000Z',
        createdAt: '2026-08-27T00:00:00.000Z',
        candidates: [
          {
            runId: 'run-1',
            algorithm: 'ols',
            status: 'SUCCEEDED',
            metrics: { rmse: 0.9 },
          },
          {
            runId: 'run-2',
            algorithm: 'ridge',
            status: 'SUCCEEDED',
            metrics: { rmse: 0.3 },
          },
        ],
      } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('done')
    expect(store.get(mpTrainingResultAtom)).toMatchObject({
      runId: 'run-2',
      algorithm: 'ridge',
      metrics: { rmse: 0.3 },
    })
    expect(store.get(mpCandidateJobIdAtom)).toBe('job-1')
  })

  it('creates a SWEEP_THEN_TUNE candidate job when both toggles are on (MODEL-FLOW-013-T11)', async () => {
    vi.mocked(modelDraftCandidateJobService.create).mockResolvedValue({
      statusCode: 201,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'job-1' } as never,
    })
    vi.mocked(modelDraftCandidateJobService.get).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: {
        id: 'job-1',
        status: 'RUNNING',
        completedRuns: 0,
        totalRuns: 2,
        candidates: [],
      } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ kind: 'SWEEP_THEN_TUNE' }),
    )
    expect(store.get(mpTrainStateAtom).status).toBe('training')
  })

  it('shows a "Tuning …" progress label once the in-flight candidate is phase 2', async () => {
    vi.mocked(modelDraftCandidateJobService.create).mockResolvedValue({
      statusCode: 201,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'job-1' } as never,
    })
    vi.mocked(modelDraftCandidateJobService.get).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: {
        id: 'job-1',
        status: 'RUNNING',
        completedRuns: 2,
        totalRuns: 4,
        candidates: [
          { algorithm: 'ols', phase: 1 },
          { algorithm: 'ridge', phase: 1 },
          { algorithm: 'ridge', phase: 2 },
          { algorithm: 'ridge', phase: 2 },
        ],
      } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).lastLog).toMatch(/^Tuning .*3 of 4…$/)
  })

  it('a single-run launch clears any previous sweep job id', async () => {
    vi.mocked(modelDraftRunService.create).mockResolvedValue({
      statusCode: 201,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'run-1' } as never,
    })
    vi.mocked(modelDraftRunService.get).mockResolvedValue({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: { id: 'run-1', status: 'RUNNING', logs: [] } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpCandidateJobIdAtom, 'job-stale')
      s.set(mpAlgorithmsAtom, ['ols'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpCandidateJobIdAtom)).toBeNull()
    expect(modelDraftRunService.create).toHaveBeenCalled()
  })
})
