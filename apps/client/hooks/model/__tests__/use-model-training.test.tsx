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
  mpPerAlgorithmHyperparamsAtom,
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

/**
 * MODEL-FLOW-020-T04. The two figures a candidate job records, shaped as
 * `/split-stats` returns them. Deliberately the REAL measured pair from this
 * system's own data — 8,350 rows holding 32 distinct labelled values — so a
 * test that confused the two would show it. A fixture where both numbers
 * were alike could not.
 */
const SPLIT_STATS = { source_rows: 8350, distinct_labelled_values: 32 }

function renderTraining(
  configure?: (store: ReturnType<typeof createStore>) => void,
  splitStats: typeof SPLIT_STATS | null = SPLIT_STATS,
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
  const rendered = renderHook(
    () => useModelTraining({ ensureDraftId, splitStats }),
    { wrapper },
  )
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

  it('refuses Find Best Parameters even if the UI-disable was bypassed by stale state (2 algorithms, no sweep — [fix] only exempts exactly 1)', async () => {
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('error')
    expect(modelDraftRunService.create).not.toHaveBeenCalled()
    expect(modelDraftCandidateJobService.create).not.toHaveBeenCalled()
  })

  // [fix]. "allow find best parameter when select 1 algorithm" — the toggle
  // no longer requires Find Best Model when exactly one algorithm is
  // selected; it sends a direct HYPERPARAMETER_SEARCH job instead, expanded
  // server-side from this ONE candidate via tuning-grid.ts's curated
  // shortlist (never built client-side).
  it('creates a HYPERPARAMETER_SEARCH job with one candidate when Find Best Parameters is on, Find Best Model is off, and exactly one algorithm is selected', async () => {
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
        totalRuns: 5,
        candidates: [],
      } as never,
    })
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, ['ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        kind: 'HYPERPARAMETER_SEARCH',
        targetY: 'TI-101',
        candidates: [{ algorithm: 'ridge', hyperparameters: { alpha: 1.0 } }],
      }),
    )
    expect(modelDraftRunService.create).not.toHaveBeenCalled()
    expect(store.get(mpTrainStateAtom).status).toBe('training')
  })

  it('refuses Find Best Parameters with zero algorithms and no sweep', async () => {
    const { result, store } = renderTraining(s => {
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, [])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('error')
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

  it('MODEL-FLOW-022. a 3-algorithm sweep sends the USER-SET value from the SECOND tab, not defaultHyperparams — a defaults fixture would pass against the bug this feature fixes', async () => {
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
        totalRuns: 3,
        candidates: [],
      } as never,
    })
    const { result } = renderTraining(s => {
      s.set(mpFindBestModelAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge', 'xgboost'])
      // The second tab's own (non-default) value — ridge's default alpha is
      // 1.0, not 0.037 (same deliberately-non-default fixture discipline
      // MODEL-FLOW-012-V01 uses for its own ridge alpha).
      s.set(mpPerAlgorithmHyperparamsAtom, { ridge: { alpha: 0.037 } })
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        kind: 'ALGORITHM_SWEEP',
        candidates: [
          { algorithm: 'ols', hyperparameters: { fit_intercept: true } },
          { algorithm: 'ridge', hyperparameters: { alpha: 0.037 } },
          expect.objectContaining({ algorithm: 'xgboost' }),
        ],
      }),
    )
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

  /**
   * MODEL-FLOW-020-T04. Every job-creating path records the two dataset size
   * figures, or neither of them.
   *
   * ALL THREE KINDS, not one: the sweep sources its candidates from the
   * client's own defaults and a direct search sends a single candidate the
   * server then expands, so they reach `create` down visibly different
   * branches. Asserting one would leave the others free to drift.
   */
  describe('MODEL-FLOW-020-T04: the dataset size figures a job records', () => {
    beforeEach(() => {
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
    })

    it.each([
      [
        'ALGORITHM_SWEEP',
        (s: ReturnType<typeof createStore>) => {
          s.set(mpFindBestModelAtom, true)
          s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
        },
      ],
      [
        'SWEEP_THEN_TUNE',
        (s: ReturnType<typeof createStore>) => {
          s.set(mpFindBestModelAtom, true)
          s.set(mpFindBestParamsAtom, true)
          s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
        },
      ],
      [
        'HYPERPARAMETER_SEARCH',
        (s: ReturnType<typeof createStore>) => {
          s.set(mpFindBestParamsAtom, true)
          s.set(mpAlgorithmsAtom, ['ridge'])
        },
      ],
    ])('sends both figures on a %s job', async (kind, configure) => {
      const { result } = renderTraining(configure)

      await act(async () => {
        result.current.start()
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          kind,
          // The ROW count and the DISTINCT count, each in its own field —
          // this is the assertion that would fail if the two were ever
          // swapped, which is the whole reason the fixture uses a real pair
          // that differs by 260x rather than two similar numbers.
          sizedRowCount: 8350,
          sizedDistinctLabelled: 32,
        }),
      )
    })

    it('sends NEITHER figure when split-stats has not resolved — the Apply-gated null path, not a bug', async () => {
      const { result } = renderTraining(s => {
        s.set(mpFindBestModelAtom, true)
        s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
      }, null)

      await act(async () => {
        result.current.start()
        await vi.advanceTimersByTimeAsync(0)
      })

      const [, body] = vi.mocked(modelDraftCandidateJobService.create).mock
        .calls[0]!
      // `not.toHaveProperty`, not `toBeUndefined`: the server's schema is
      // `.strict()` with a together-or-neither refine, so an explicitly
      // present `sizedRowCount: undefined` and an absent key are different
      // requests. Only the absent one is correct here.
      expect(body).not.toHaveProperty('sizedRowCount')
      expect(body).not.toHaveProperty('sizedDistinctLabelled')
    })
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
