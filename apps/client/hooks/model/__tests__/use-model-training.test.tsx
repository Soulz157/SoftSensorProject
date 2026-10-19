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
  mpFindBestParamsAtom,
  mpExtraVariantsAtom,
  mpTargetVariableAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  mpCandidateJobIdAtom,
  mpTrainStateAtom,
  mpPerAlgorithmHyperparamsAtom,
  mpNSplitsAtom,
  mpLossFunctionAtom,
  mpTrainTestSplitAtom,
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

// MODEL-FLOW-035. A fine-tune's base is the chosen run's values laid over the
// algorithm's defaults; ridge's defaults, here, stand in for that record.
const RIDGE_BASE = { alpha: 1.0, fit_intercept: true, solver: 'auto' } as const

describe('useModelTraining — MODEL-FLOW-013-T07/T11', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // MODEL-FLOW-016, kept 2026-10-14: CV fits one algorithm. The CV control
  // turns itself off when a second algorithm is added; this is the backstop
  // for stale state.
  it('refuses Cross-Validation with two algorithms, even if the UI-disable was bypassed by stale state', async () => {
    const { result, store } = renderTraining(s => {
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
      s.set(mpNSplitsAtom, 5)
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
  it('Fine-tune with the curated variants sends a one-candidate HYPERPARAMETER_SEARCH, ranked by the Loss function', async () => {
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
      s.set(mpAlgorithmsAtom, ['ridge'])
    })

    await act(async () => {
      result.current.fineTune({
        algorithm: 'ridge',
        base: RIDGE_BASE,
        rows: [],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        kind: 'HYPERPARAMETER_SEARCH',
        rankingMetric: 'rmse',
        targetY: 'TI-101',
        candidates: [
          {
            algorithm: 'ridge',
            hyperparameters: {
              alpha: 1.0,
              fit_intercept: true,
              solver: 'auto',
            },
          },
        ],
      }),
    )
    expect(modelDraftRunService.create).not.toHaveBeenCalled()
    expect(store.get(mpTrainStateAtom).status).toBe('training')
  })

  /**
   * MODEL-FLOW-029. This branch used to send the ratio unconditionally, so a
   * user with Cross-Validation on got chronological variants. With CV on it
   * sends exactly `nSplits`; with CV off, exactly the ratio.
   */
  it.each([
    [3, { nSplits: 3 }, 'trainTestSplit'],
    [undefined, { trainTestSplit: 0.7 }, 'nSplits'],
  ] as const)(
    'a fine-tune with nSplits=%s sends %o and never %s',
    async (nSplits, expected, absent) => {
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
      const { result } = renderTraining(s => {
        s.set(mpAlgorithmsAtom, ['ridge'])
        s.set(mpNSplitsAtom, nSplits)
        s.set(mpTrainTestSplitAtom, 70)
      })

      await act(async () => {
        result.current.fineTune({
          algorithm: 'ridge',
          base: RIDGE_BASE,
          rows: [],
          useGrid: true,
        })
        await vi.advanceTimersByTimeAsync(0)
      })

      const body = vi.mocked(modelDraftCandidateJobService.create).mock
        .calls[0]![1]
      expect(body).toMatchObject(expected)
      expect(body).not.toHaveProperty(absent)
    },
  )

  /**
   * MODEL-FLOW-026. Step 3's hand-added variant rows ride along on the
   * direct search and nowhere else — a SWEEP_THEN_TUNE job builds its tuning
   * phase server-side from the job row, which carries no such list, and the
   * DTO refuses the field there rather than promise a search that never runs.
   */
  it('sends the hand-added variants with a direct HYPERPARAMETER_SEARCH', async () => {
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
        totalRuns: 6,
        candidates: [],
      } as never,
    })
    const { result } = renderTraining(s => {
      s.set(mpAlgorithmsAtom, ['ridge'])
      s.set(mpExtraVariantsAtom, {
        ridge: [{ alpha: 7 }],
        // Another algorithm's rows belong to that card, not this job.
        svm: [{ C: 3 }],
      })
    })

    await act(async () => {
      result.current.fineTune({
        algorithm: 'ridge',
        base: RIDGE_BASE,
        rows: [{ alpha: 7 }],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ extraVariants: [{ alpha: 7 }] }),
    )
  })

  it('omits extraVariants entirely when the user added none', async () => {
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
    const { result } = renderTraining(s => {
      s.set(mpAlgorithmsAtom, ['ridge'])
    })

    await act(async () => {
      result.current.fineTune({
        algorithm: 'ridge',
        base: RIDGE_BASE,
        rows: [],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    const [, payload] = vi.mocked(modelDraftCandidateJobService.create).mock
      .calls[0]!
    expect(payload).not.toHaveProperty('extraVariants')
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

  // 2026-10-14. One algorithm plus the user's own rows, Find Best Parameters
  // off: a search over exactly those rows. Several candidates means the
  // server expands no grid, so nothing beyond what the user typed runs.
  it('Fine-tune without the curated variants trains the run and its added rows as a HYPERPARAMETER_SEARCH of exactly those candidates', async () => {
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
    const { result } = renderTraining(s => {
      s.set(mpAlgorithmsAtom, ['ridge'])
    })

    await act(async () => {
      result.current.fineTune({
        algorithm: 'ridge',
        base: RIDGE_BASE,
        rows: [{ alpha: 7 }],
        useGrid: false,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftRunService.create).not.toHaveBeenCalled()
    const [, payload] = vi.mocked(modelDraftCandidateJobService.create).mock
      .calls[0]!
    expect(payload.kind).toBe('HYPERPARAMETER_SEARCH')
    expect(payload.candidates).toHaveLength(2)
    expect(payload.candidates[1]?.hyperparameters).toMatchObject({ alpha: 7 })
    expect(payload).not.toHaveProperty('extraVariants')
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
          {
            algorithm: 'ridge',
            hyperparameters: {
              alpha: 1.0,
              fit_intercept: true,
              solver: 'auto',
            },
          },
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
          {
            algorithm: 'ridge',
            hyperparameters: {
              alpha: 0.037,
              fit_intercept: true,
              solver: 'auto',
            },
          },
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

  it('never sends SWEEP_THEN_TUNE any more: two algorithms with the old toggle on are an ALGORITHM_SWEEP (MODEL-FLOW-035)', async () => {
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
      s.set(mpFindBestParamsAtom, true)
      s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ kind: 'ALGORITHM_SWEEP' }),
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
          s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
        },
        false,
      ],
      [
        'HYPERPARAMETER_SEARCH',
        (s: ReturnType<typeof createStore>) => {
          s.set(mpAlgorithmsAtom, ['ridge'])
        },
        true,
      ],
    ])('sends both figures on a %s job', async (kind, configure, fine) => {
      const { result } = renderTraining(configure)

      await act(async () => {
        if (fine) {
          result.current.fineTune({
            algorithm: 'ridge',
            base: RIDGE_BASE,
            rows: [],
            useGrid: true,
          })
        } else {
          result.current.start()
        }
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

    it('sends NEITHER figure when split-stats has not resolved and the dataset carries no row count — the honest null, not a bug', async () => {
      const { result } = renderTraining(s => {
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

  // [fix]. toBackendAlgorithm used to refuse lstm/gru unconditionally,
  // including a plain single run — even though MODEL-FLOW-009-T04's own
  // windowing pipeline trains them live. A user hit this reported as
  // "Cannot train because 'LSTM' isn't supported by the training service
  // yet". Neither toggle is on here, so this is the path that must work.
  it('[fix] launches a plain lstm single run — no longer refused outside a candidate job', async () => {
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
      s.set(mpAlgorithmsAtom, ['lstm'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftRunService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ algorithm: 'lstm' }),
    )
    expect(store.get(mpTrainStateAtom).status).not.toBe('error')
  })

  // [fix]. A SWEEP is the half that still refuses lstm/gru. MODEL-FLOW-024
  // CORRECTS the reason this comment used to give: the candidate-job service
  // does not 400 a sequence candidate (it never mentions them) — the refusal
  // is a scope decision, kept because a sweep would launch up to three
  // sequence fits before any tuning. Defense in depth for stale draft state —
  // AlgorithmStack notes the mix under its cards; this is the backstop.
  it('[fix] still refuses lstm beside another algorithm — a sweep of sequence models is not enabled', async () => {
    const { result, store } = renderTraining(s => {
      s.set(mpAlgorithmsAtom, ['lstm', 'ridge'])
    })

    await act(async () => {
      result.current.start()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(store.get(mpTrainStateAtom).status).toBe('error')
    expect(modelDraftCandidateJobService.create).not.toHaveBeenCalled()
  })

  /**
   * MODEL-FLOW-024. This case used to assert the OPPOSITE ("still refuses lstm
   * with Find Best Parameters alone"), on the claim the job service cannot
   * take a sequence candidate. What refused it was the empty tuning grid,
   * which now exists. The job goes out as a HYPERPARAMETER_SEARCH of ONE lstm
   * candidate, expanded server-side like any other.
   */
  it('Fine-tunes lstm on its own as a HYPERPARAMETER_SEARCH', async () => {
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
      s.set(mpAlgorithmsAtom, ['lstm'])
    }, null)

    await act(async () => {
      result.current.fineTune({
        algorithm: 'lstm',
        base: { sequence_length: 24 },
        rows: [],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        kind: 'HYPERPARAMETER_SEARCH',
        candidates: [expect.objectContaining({ algorithm: 'lstm' })],
      }),
    )
    expect(store.get(mpTrainStateAtom).status).toBe('training')
  })

  it('sends the dataset row count ALONE for a sequence search — split stats are never fetched for lstm/gru, so there is no distinct count to send', async () => {
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
    const { result } = renderTraining(s => {
      s.set(mpSelectedDatasetAtom, {
        ...DATASET,
        rowCount: 400,
      } as SavedDataset)
      s.set(mpAlgorithmsAtom, ['gru'])
    }, null)

    await act(async () => {
      result.current.fineTune({
        algorithm: 'gru',
        base: { sequence_length: 24 },
        rows: [],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    const [, body] = vi.mocked(modelDraftCandidateJobService.create).mock
      .calls[0]!
    expect(body).toHaveProperty('sizedRowCount', 400)
    // The schema refuses a distinct count without rows; the reverse is the
    // sequence case. It must not be invented from the row count.
    expect(body).not.toHaveProperty('sizedDistinctLabelled')
  })

  // The size tier keys on rows (the user's decision, 2026-09-21), and the Step 3
  // form sizes its ranges from the dataset's own count before Apply. The job
  // must send that same figure, or the form would show one tier while the
  // search ran another. These two used to assert the opposite — a tabular job
  // before Apply sent nothing — when the tier keyed on a distinct count that
  // only the split-stats fetch could supply.
  it.each([
    [
      'a tabular HYPERPARAMETER_SEARCH',
      (s: ReturnType<typeof createStore>) => {
        s.set(mpAlgorithmsAtom, ['ridge'])
      },
      true,
    ],
    [
      'an ALGORITHM_SWEEP',
      (s: ReturnType<typeof createStore>) => {
        s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
      },
      false,
    ],
  ])(
    'sends the dataset row count ALONE for %s before Apply, the same figure the form sizes from',
    async (_label, configure, fine) => {
      const { result } = renderTraining(s => {
        s.set(mpSelectedDatasetAtom, {
          ...DATASET,
          rowCount: 400,
        } as SavedDataset)
        configure(s)
      }, null)

      await act(async () => {
        if (fine) {
          result.current.fineTune({
            algorithm: 'ridge',
            base: RIDGE_BASE,
            rows: [],
            useGrid: true,
          })
        } else {
          result.current.start()
        }
        await vi.advanceTimersByTimeAsync(0)
      })

      const [, body] = vi.mocked(modelDraftCandidateJobService.create).mock
        .calls[0]!
      expect(body).toHaveProperty('sizedRowCount', 400)
      expect(body).not.toHaveProperty('sizedDistinctLabelled')
    },
  )

  it('prefers the split-stats source_rows over the dataset row count once Apply resolved', async () => {
    const { result } = renderTraining(s => {
      s.set(mpSelectedDatasetAtom, {
        ...DATASET,
        rowCount: 400,
      } as SavedDataset)
      s.set(mpAlgorithmsAtom, ['ridge'])
    })

    await act(async () => {
      result.current.fineTune({
        algorithm: 'ridge',
        base: RIDGE_BASE,
        rows: [],
        useGrid: true,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    const [, body] = vi.mocked(modelDraftCandidateJobService.create).mock
      .calls[0]!
    expect(body).toHaveProperty('sizedRowCount', 8350)
    expect(body).toHaveProperty('sizedDistinctLabelled', 32)
  })

  /**
   * MODEL-FLOW-035. Round 1 trains each algorithm once with its card values.
   * The pre-existing "Find Best Parameters" atom and the added-rows atom are
   * still persisted, but Start Training no longer reads either.
   */
  describe('MODEL-FLOW-035: Start Training is Round 1 — card values only', () => {
    beforeEach(() => {
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
    })

    it('one algorithm with added rows and the old toggle on is still a single run', async () => {
      const { result } = renderTraining(s => {
        s.set(mpFindBestParamsAtom, true)
        s.set(mpAlgorithmsAtom, ['ridge'])
        s.set(mpExtraVariantsAtom, { ridge: [{ alpha: 7 }] })
      })

      await act(async () => {
        result.current.start()
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(modelDraftRunService.create).toHaveBeenCalledTimes(1)
      expect(modelDraftCandidateJobService.create).not.toHaveBeenCalled()
    })

    it('sends the Loss function as the job ranking metric', async () => {
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
      const { result } = renderTraining(s => {
        s.set(mpAlgorithmsAtom, ['ols', 'ridge'])
        s.set(mpLossFunctionAtom, 'mae')
      })

      await act(async () => {
        result.current.start()
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(modelDraftCandidateJobService.create).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({
          kind: 'ALGORITHM_SWEEP',
          rankingMetric: 'mae',
        }),
      )
    })
  })
})
