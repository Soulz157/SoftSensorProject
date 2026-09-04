import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { Phase4ModelSelection } from '../phase-4-model-selection'
import {
  mpCandidateJobIdAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import type {
  CandidateResult,
  ModelCandidateJob,
  ModelTrainingRunListItem,
} from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

const h = vi.hoisted(() => ({
  result: {
    job: null as ModelCandidateJob | null,
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
  // MODEL-FLOW-018-T04. Default empty — the pre-existing single-run tests
  // below never configure this, and `runs.length <= 1` (0 here) must still
  // take the unmodified SingleRunSummary branch, not the comparison table.
  runsResult: {
    runs: [] as ModelTrainingRunListItem[],
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
  selectionResult: {
    selectedRunId: null as string | null,
    loading: false,
    refetch: vi.fn(),
  },
}))

vi.mock('@/hooks/model/use-candidate-job', () => ({
  useCandidateJob: () => h.result,
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.runsResult,
}))

vi.mock('@/hooks/model/use-draft-selection', () => ({
  useDraftSelection: () => h.selectionResult,
}))

vi.mock('@/services/model-draft', async () => {
  const actual = await vi.importActual<typeof import('@/services/model-draft')>(
    '@/services/model-draft',
  )
  return {
    ...actual,
    modelDraftCandidateJobService: {
      select: vi.fn().mockResolvedValue({}),
    },
    modelDraftService: {
      ...actual.modelDraftService,
      selectRun: vi.fn().mockResolvedValue({}),
    },
  }
})

const NAV = { goTo: vi.fn() } as unknown as UsePipelineNavResult

function candidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    runId: 'run-1',
    algorithm: 'ols',
    hyperparameters: { fit_intercept: true },
    phase: 1,
    status: 'SUCCEEDED',
    failureReason: null,
    metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
    trainMetrics: { r2: 0.95, rmse: 0.3, mae: 0.2 },
    lossHistoryKey: null,
    lossHistory: null,
    predictionsKey: null,
    cvFoldsKey: null,
    scoringContainerId: null,
    ...overrides,
  }
}

function job(overrides: Partial<ModelCandidateJob> = {}): ModelCandidateJob {
  return {
    id: 'job-1',
    modelDraftId: 'draft-1',
    targetY: 'TI-101',
    goldArtifactId: 'art-1',
    trainTestSplit: 0.8,
    kind: 'ALGORITHM_SWEEP',
    totalRuns: 2,
    completedRuns: 2,
    status: 'SUCCEEDED',
    failureReason: null,
    currentRunId: null,
    bestRunId: 'run-1',
    bestRmse: 0.5,
    selectedRunId: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    startedAt: '2026-08-28T00:00:01.000Z',
    finishedAt: '2026-08-28T00:00:30.000Z',
    candidates: [candidate()],
    ...overrides,
  }
}

function renderStep(
  configure?: (store: ReturnType<typeof createStore>) => void,
) {
  const store = createStore()
  store.set(mpServerDraftIdAtom, 'draft-1')
  // Applied BEFORE render, not after — a bare `store.set` following `render()`
  // is not itself wrapped in `act()`, so a later assertion can read a stale
  // pre-set render. Same fix as `use-model-training.test.tsx`'s `renderTraining`.
  configure?.(store)
  return {
    store,
    ...render(
      <Provider store={store}>
        <Phase4ModelSelection nav={NAV} />
      </Provider>,
    ),
  }
}

beforeEach(() => {
  h.result.job = null
  h.result.loading = false
  h.result.error = null
  h.result.refetch = vi.fn()
  h.runsResult.runs = []
  h.runsResult.loading = false
  h.runsResult.error = null
  h.runsResult.refetch = vi.fn()
  h.selectionResult.selectedRunId = null
  h.selectionResult.loading = false
  h.selectionResult.refetch = vi.fn()
  NAV.goTo = vi.fn()
})

function trainingRun(
  overrides: Partial<ModelTrainingRunListItem> = {},
): ModelTrainingRunListItem {
  return {
    id: 'run-1',
    status: 'SUCCEEDED',
    failureReason: null,
    datasetId: 'ds-1',
    goldArtifactId: 'art-1',
    artifactChecksum: 'sha256:abc',
    featureSpecKey: 'feature_spec.json',
    targetY: 'TI-101',
    algorithm: 'ridge',
    hyperparameters: { alpha: 0.037 },
    seed: 4242,
    splitSpec: { method: 'chronological', ratio: 0.7 },
    imageDigest: 'sha256:0123456789abcdef',
    modelKey: 'model.joblib',
    metrics: { r2: 0.9, rmse: 0.5 },
    holdoutMetrics: null,
    cvFoldsKey: null,
    predictionsKey: null,
    scoringContainerId: null,
    lossHistoryKey: null,
    candidateJobId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    startedAt: '2026-08-27T00:00:01.000Z',
    finishedAt: '2026-08-27T00:00:30.000Z',
    ...overrides,
  }
}

describe('Phase4ModelSelection (MODEL-FLOW-013)', () => {
  it('renders an honest empty state when there is no training run yet', () => {
    renderStep()
    expect(screen.getByText(/No training run yet/i)).toBeInTheDocument()
  })

  it('passes a single run through honestly — no comparison table, no stalling', () => {
    // mpCandidateJobIdAtom stays null — no sweep happened.
    renderStep(store =>
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ridge',
        metrics: { rmse: 0.42 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      }),
    )

    expect(screen.getByText('Ridge Regression trained')).toBeInTheDocument()
    expect(screen.getByText(/Only one candidate this run/)).toBeInTheDocument()
    expect(screen.queryByText('Select')).not.toBeInTheDocument()
  })

  it('renders each candidate — a FAILED one stays listed with its reason, never silently dropped', () => {
    h.result.job = job({
      candidates: [
        candidate({ runId: 'run-1', algorithm: 'ridge', status: 'SUCCEEDED' }),
        candidate({
          runId: 'run-2',
          algorithm: 'svm',
          status: 'FAILED',
          failureReason: 'container OOM',
          metrics: null,
          trainMetrics: null,
        }),
      ],
    })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ridge',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.getByText('Ridge Regression')).toBeInTheDocument()
    expect(screen.getByText('Support Vector Machine')).toBeInTheDocument()
    expect(screen.getByText('container OOM')).toBeInTheDocument()
  })

  it('marks the resolved winner as Selected and offers Select on the others', () => {
    h.result.job = job({
      bestRunId: 'run-1',
      candidates: [
        candidate({ runId: 'run-1', algorithm: 'ridge' }),
        candidate({
          runId: 'run-2',
          algorithm: 'svm',
          metrics: { r2: 0.8, rmse: 0.6, mae: 0.5 },
        }),
      ],
    })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ridge',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.getByText('Selected')).toBeInTheDocument()
    expect(screen.getAllByText('Select')).toHaveLength(1)
  })

  it('renders mode B (paired marks, no line) for a closed-form algorithm with no loss history', () => {
    h.result.job = job({
      candidates: [candidate({ algorithm: 'ols', lossHistory: null })],
    })
    const { container } = renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ols',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(
      screen.getByText(/No iteration-by-iteration curve/i),
    ).toBeInTheDocument()
    // No chart svg for mode B — no line series to draw.
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(0)
  })

  it('renders mode A (a real chart) for a run with lossHistory, labelling the second series "Test split"', () => {
    h.result.job = job({
      candidates: [
        candidate({
          algorithm: 'xgboost',
          lossHistoryKey: 'drafts/d/runs/r/loss_history.json',
          lossHistory: {
            algorithm: 'xgboost',
            metric: 'rmse',
            series: { train: [1.0, 0.5, 0.3], validation: [1.1, 0.6, 0.4] },
          },
        }),
      ],
    })
    const { container } = renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'xgboost',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.getByText('Test split')).toBeInTheDocument()
    expect(screen.queryByText('Validation')).not.toBeInTheDocument()
    expect(
      container.querySelectorAll('.recharts-wrapper, svg').length,
    ).toBeGreaterThan(0)
  })

  it('calls select and refetches when a non-winning candidate is chosen', async () => {
    const { modelDraftCandidateJobService } =
      await import('@/services/model-draft')
    h.result.job = job({
      bestRunId: 'run-1',
      candidates: [
        candidate({ runId: 'run-1', algorithm: 'ridge' }),
        candidate({ runId: 'run-2', algorithm: 'svm' }),
      ],
    })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ridge',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    fireEvent.click(screen.getByText('Select'))

    await waitFor(() => {
      expect(modelDraftCandidateJobService.select).toHaveBeenCalledWith(
        'draft-1',
        'job-1',
        'run-2',
      )
    })
    expect(h.result.refetch).toHaveBeenCalled()
  })

  it('shows a running-sweep state honestly rather than an empty table', () => {
    h.result.job = job({ status: 'RUNNING', completedRuns: 1, totalRuns: 3 })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ridge',
        metrics: null,
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
  })

  it('renders both groups, headed "Sweep" and "Tuning <winner>", for a two-phase job (MODEL-FLOW-013-T11)', () => {
    h.result.job = job({
      kind: 'SWEEP_THEN_TUNE',
      bestRunId: 'run-3',
      candidates: [
        candidate({ runId: 'run-1', algorithm: 'ols', phase: 1 }),
        candidate({ runId: 'run-2', algorithm: 'ridge', phase: 1 }),
        candidate({ runId: 'run-3', algorithm: 'ridge', phase: 2 }),
        candidate({ runId: 'run-4', algorithm: 'ridge', phase: 2 }),
      ],
    })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ols',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.getByText('Sweep')).toBeInTheDocument()
    expect(screen.getByText('Tuning Ridge Regression')).toBeInTheDocument()
  })

  it('renders no "Tuning" header for a one-phase job — an ALGORITHM_SWEEP, or a SWEEP_THEN_TUNE still mid-sweep', () => {
    h.result.job = job({
      kind: 'SWEEP_THEN_TUNE',
      candidates: [
        candidate({ runId: 'run-1', algorithm: 'ols', phase: 1 }),
        candidate({ runId: 'run-2', algorithm: 'ridge', phase: 1 }),
      ],
    })
    renderStep(store => {
      store.set(mpTrainingResultAtom, {
        runId: 'run-1',
        algorithm: 'ols',
        metrics: { rmse: 0.5 },
        trainedAt: '2026-08-28T00:00:00.000Z',
        cvFoldsKey: null,
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.queryByText('Sweep')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Tuning /)).not.toBeInTheDocument()
  })
})

describe('Phase4ModelSelection — standalone comparison (MODEL-FLOW-018-T04)', () => {
  function setupNoJob(
    store: ReturnType<typeof createStore>,
    trainingResultOverrides: Partial<Parameters<typeof store.set>[1]> = {},
  ) {
    store.set(mpTrainingResultAtom, {
      runId: 'run-1',
      algorithm: 'ridge',
      metrics: { rmse: 0.5 },
      trainedAt: '2026-08-27T00:00:30.000Z',
      cvFoldsKey: null,
      ...trainingResultOverrides,
    })
    // mpCandidateJobIdAtom stays null — no CURRENT job to compare through.
  }

  it('still passes a TRUE single-run draft through with no table (runs.length <= 1)', () => {
    h.runsResult.runs = [trainingRun()]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('Ridge Regression trained')).toBeInTheDocument()
    expect(screen.queryByText('Select')).not.toBeInTheDocument()
  })

  // The gate counts SELECTABLE (SUCCEEDED) runs, not raw row count — two
  // rows with only one SUCCEEDED among them is still "nothing to choose
  // between," matching MODEL-FLOW-013's own acceptance criterion by what it
  // actually means rather than by row count.
  it('still passes through with no table when only ONE of two runs SUCCEEDED', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a' }),
      trainingRun({ id: 'run-b', status: 'FAILED', metrics: null }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('Ridge Regression trained')).toBeInTheDocument()
    expect(screen.queryByText('Select')).not.toBeInTheDocument()
  })

  it('renders a comparison table for 2+ standalone runs no job owns — including two CV runs', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv-2',
        algorithm: 'ridge',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05, n_splits: 5 },
        createdAt: '2026-08-27T01:00:00.000Z',
      }),
      trainingRun({
        id: 'run-cv-1',
        algorithm: 'ridge',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.6, cv_rmse_std: 0.08, n_splits: 5 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    expect(
      screen.queryByText('Ridge Regression trained'),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('Ridge Regression')).toHaveLength(2)
    expect(screen.getByText('0.400 ± 0.050')).toBeInTheDocument()
    expect(screen.getByText('0.600 ± 0.080')).toBeInTheDocument()
    // MODEL-FLOW-018-T06: neither run has a `predictionsKey` (awaiting
    // scoring) — the label says so, distinct from a scored run's "Holdout
    // RMSE", so the fold-mean estimate is never mistaken for the shipped
    // model's own score.
    expect(screen.getAllByText('Est. CV RMSE')).toHaveLength(2)
    expect(screen.getAllByText('Select')).toHaveLength(2)
  })

  // Two SUCCEEDED runs alongside the RUNNING/FAILED ones — the gate opens
  // the table on SELECTABLE count (2 here), not raw row count, and once
  // open every row renders, including the non-SUCCEEDED ones with their own
  // stated reason (MODEL-FLOW-013-T07's "never silently drop a row" rule).
  it('disables Select with a stated reason for a non-terminal or FAILED/CANCELED standalone run', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', status: 'RUNNING', metrics: null }),
      trainingRun({
        id: 'run-b',
        status: 'FAILED',
        failureReason: 'container OOM',
        metrics: null,
      }),
      trainingRun({ id: 'run-c', algorithm: 'ridge' }),
      trainingRun({ id: 'run-d', algorithm: 'svm', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    const buttons = screen
      .getAllByText('Select')
      .map(el => el.closest('button'))
    // run-a (RUNNING) and run-b (FAILED) are disabled; run-c/run-d
    // (SUCCEEDED) are the ones that made the table open at all.
    expect(buttons[0]).toBeDisabled()
    expect(buttons[1]).toBeDisabled()
    expect(buttons[2]).not.toBeDisabled()
    expect(buttons[3]).not.toBeDisabled()
    expect(
      screen.getByText(/Available once this run finishes/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/didn't succeed.*nothing to carry forward/i),
    ).toBeInTheDocument()
    expect(screen.getByText('container OOM')).toBeInTheDocument()
  })

  it('marks the standalone-selected run "Carrying forward" and hides its own Select button', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', algorithm: 'ridge' }),
      trainingRun({ id: 'run-b', algorithm: 'svm', metrics: { rmse: 0.6 } }),
    ]
    h.selectionResult.selectedRunId = 'run-b'
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('Carrying forward')).toBeInTheDocument()
    // Only run-a's Select remains — run-b's own button is hidden once selected.
    expect(screen.getAllByText('Select')).toHaveLength(1)
  })

  it('selecting a standalone run calls selectRun(draftId, runId) and refetches the selection', async () => {
    const { modelDraftService } = await import('@/services/model-draft')
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', algorithm: 'ridge' }),
      trainingRun({ id: 'run-b', algorithm: 'svm', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    fireEvent.click(screen.getAllByText('Select')[0]!)

    await waitFor(() => {
      expect(modelDraftService.selectRun).toHaveBeenCalledWith(
        'draft-1',
        'run-a',
      )
    })
    expect(h.selectionResult.refetch).toHaveBeenCalled()
  })

  it('surfaces the server refusal message rather than silently failing', async () => {
    const { modelDraftService } = await import('@/services/model-draft')
    ;(modelDraftService.selectRun as Mock).mockRejectedValueOnce(
      new Error("This run's candidate job is still RUNNING."),
    )
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', algorithm: 'ridge' }),
      trainingRun({ id: 'run-b', algorithm: 'svm', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    fireEvent.click(screen.getAllByText('Select')[0]!)

    await waitFor(() => {
      expect(
        screen.getByText(/candidate job is still RUNNING/i),
      ).toBeInTheDocument()
    })
  })
})

describe('Phase4ModelSelection — targetY grouping and comparability notes (MODEL-FLOW-018-T05)', () => {
  function setupNoJob(store: ReturnType<typeof createStore>) {
    store.set(mpTrainingResultAtom, {
      runId: 'run-1',
      algorithm: 'ridge',
      metrics: { rmse: 0.5 },
      trainedAt: '2026-08-27T00:00:30.000Z',
      cvFoldsKey: null,
    })
  }

  it('never shows a section header for a single-target set — the common case renders exactly as before grouping existed', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a' }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    // Both rows still name their own target inline; only the DEDICATED
    // header paragraph (no timestamp alongside it) would collide with this
    // exact-text query, and it must not exist here.
    expect(screen.queryByText('y = TI-101')).not.toBeInTheDocument()
  })

  it('sections two different targets into SEPARATE grids, each headed by its own target — never one shared metric column', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', targetY: 'TI-101' }),
      trainingRun({ id: 'run-b', targetY: 'TI-101', metrics: { rmse: 0.6 } }),
      trainingRun({ id: 'run-c', targetY: 'TI-202', algorithm: 'svm' }),
      trainingRun({
        id: 'run-d',
        targetY: 'TI-202',
        algorithm: 'svm',
        metrics: { rmse: 0.3 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('y = TI-101')).toBeInTheDocument()
    expect(screen.getByText('y = TI-202')).toBeInTheDocument()
    expect(screen.getAllByText('Select')).toHaveLength(4)
  })

  it('a TI-202-only run does not gain a comparability note against a TI-101 group it is never compared to', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', targetY: 'TI-101' }),
      trainingRun({ id: 'run-b', targetY: 'TI-101', metrics: { rmse: 0.6 } }),
      trainingRun({ id: 'run-c', targetY: 'TI-202', algorithm: 'svm' }),
      trainingRun({
        id: 'run-d',
        targetY: 'TI-202',
        algorithm: 'svm',
        metrics: { rmse: 0.3 },
        goldArtifactId: 'art-DIFFERENT',
      }),
    ]
    renderStep(store => setupNoJob(store))

    // Scoped per group, not just counted — run-a/run-b (TI-101, default
    // algorithm 'ridge') must carry NO note even though the OTHER group
    // (TI-202, 'svm') has one. A total-count assertion alone can't tell a
    // note landing on the wrong group from one landing on the right group.
    const notePattern = /Not the same comparison as the other rows here/
    const ti101Cards = screen
      .getAllByText('Ridge Regression')
      .map(el => el.closest('.rounded-xl') as HTMLElement)
    for (const card of ti101Cards) {
      expect(within(card).queryByText(notePattern)).not.toBeInTheDocument()
    }

    const ti202Cards = screen
      .getAllByText('Support Vector Machine')
      .map(el => el.closest('.rounded-xl') as HTMLElement)
    for (const card of ti202Cards) {
      expect(within(card).getByText(notePattern)).toBeInTheDocument()
    }
  })

  it('names a differing dataset artifact on BOTH rows within the same target — symmetric, no arbitrary "reference" row', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', goldArtifactId: 'art-1' }),
      trainingRun({
        id: 'run-b',
        goldArtifactId: 'art-2',
        metrics: { rmse: 0.6 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    const notes = screen.getAllByText(/a different dataset artifact/)
    expect(notes).toHaveLength(2)
  })

  it('names a differing feature spec, non-blocking — Select stays enabled', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', featureSpecKey: 'spec-a.json' }),
      trainingRun({
        id: 'run-b',
        featureSpecKey: 'spec-b.json',
        metrics: { rmse: 0.6 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getAllByText(/a different feature spec/)).toHaveLength(2)
    for (const btn of screen
      .getAllByText('Select')
      .map(el => el.closest('button'))) {
      expect(btn).not.toBeDisabled()
    }
  })

  it('names a differing split shape (CV vs. a chronological split) on the SAME target, non-blocking', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-a',
        splitSpec: { method: 'chronological', ratio: 0.7 },
      }),
      trainingRun({
        id: 'run-b',
        cvFoldsKey: 'cv_folds.json',
        // MODEL-FLOW-016-T03's own real shape — no `ratio` at all.
        splitSpec: { method: 'cv_expanding', n_splits: 5 } as never,
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05, n_splits: 5 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText(/a 70\/30 chronological split/)).toBeInTheDocument()
    expect(screen.getByText(/5-fold cross-validation/)).toBeInTheDocument()
    for (const btn of screen
      .getAllByText('Select')
      .map(el => el.closest('button'))) {
      expect(btn).not.toBeDisabled()
    }
  })

  it('names a differing split shape even when splitSpec itself is identical — cvFoldsKey is the real discriminator, not splitSpec.method (advisor regression 2026-09-04)', () => {
    // Both rows carry the SAME default chronological splitSpec (T04's own
    // fixture shape, which never bothered setting splitSpec for its CV
    // runs) — only cvFoldsKey marks run-b as CV. Keying the note off
    // splitSpec.method alone would silently miss this: the metric column
    // (which trusts cvFoldsKey) would show "CV RMSE" next to "Test RMSE"
    // with no note explaining they aren't the same quantity.
    h.runsResult.runs = [
      trainingRun({ id: 'run-a' }),
      trainingRun({
        id: 'run-b',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
      }),
    ]
    renderStep(store => setupNoJob(store))

    expect(
      screen.getAllByText(/Not the same comparison as the other rows here/),
    ).toHaveLength(2)
  })

  it('adds no note when every axis matches within the group — nothing fabricated', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a' }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    expect(
      screen.queryByText(/Not the same comparison as the other rows here/),
    ).not.toBeInTheDocument()
  })
})

describe('Phase4ModelSelection — an honest metric column across run kinds (MODEL-FLOW-018-T06)', () => {
  function setupNoJob(store: ReturnType<typeof createStore>) {
    store.set(mpTrainingResultAtom, {
      runId: 'run-1',
      algorithm: 'ridge',
      metrics: { rmse: 0.5 },
      trainedAt: '2026-08-27T00:00:30.000Z',
      cvFoldsKey: null,
    })
  }

  it('renders an em dash, never 0, for a non-CV SUCCEEDED run with no numeric rmse', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', metrics: {} }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    // `getByText('—')` is a SINGULAR query — asserting run-b's own value
    // renders too confirms it isn't masking a second `—` that would make
    // this throw instead of pass.
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('0.600')).toBeInTheDocument()
    expect(screen.getAllByText('Test RMSE')).toHaveLength(2)
    // The real failure mode a `0` fallback would produce — `'0'` alone can
    // never appear here even from a bug, since the row always formats via
    // `toFixed(3)`.
    expect(screen.queryByText('0.000')).not.toBeInTheDocument()
  })

  it('shows the fold-mean ESTIMATE, labelled distinctly, for an awaiting-scoring CV run not yet selected — no scoring action offered', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
      }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('0.400 ± 0.050')).toBeInTheDocument()
    expect(screen.getByText('Est. CV RMSE')).toBeInTheDocument()
    expect(
      screen.getByText(
        /An estimate of the configuration, not the shipped model's own score\. Select it to score it/,
      ),
    ).toBeInTheDocument()
    // Offering the action here would silently resolve Evaluation to
    // WHATEVER run is currently active — not necessarily this one — since
    // this row isn't the draft's own selection yet.
    expect(screen.queryByText('Score in Evaluation')).not.toBeInTheDocument()
  })

  it('offers "Score in Evaluation" only once this row IS the carrying-forward selection, and it moves to Step 5 honestly (never nav.goTo, which can read stale state)', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
      }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    h.selectionResult.selectedRunId = 'run-cv'
    const { store } = renderStep(store => setupNoJob(store))

    expect(
      screen.getByText(
        /An estimate of the configuration, not the shipped model's own score — score it/,
      ),
    ).toBeInTheDocument()
    const button = screen.getByText('Score in Evaluation')
    fireEvent.click(button)

    expect(store.get(mpCurrentStepAtom)).toBe(5)
    expect(store.get(mpHighestUnlockedAtom)).toBeGreaterThanOrEqual(5)
  })

  it('shows a running-scoring state honestly, with no action to click twice', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        scoringContainerId: 'container-1',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
      }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    h.selectionResult.selectedRunId = 'run-cv'
    renderStep(store => setupNoJob(store))

    expect(
      screen.getByText(/Scoring against the holdout is running/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Score in Evaluation')).not.toBeInTheDocument()
  })

  it('reads a scored CV run’s RMSE from holdoutMetrics — the refit’s own number — never the fold mean, and drops the pre-scoring note', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        predictionsKey: 'predictions.parquet',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
        holdoutMetrics: { rmse: 0.35, r2: 0.91 },
      }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('0.350')).toBeInTheDocument()
    expect(screen.getByText('Holdout RMSE')).toBeInTheDocument()
    // The fold mean must not leak through once a real holdout score exists.
    expect(screen.queryByText('0.400 ± 0.050')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/estimate of the configuration/),
    ).not.toBeInTheDocument()
  })

  it('renders an em dash for a scored CV run whose holdoutMetrics carries no numeric rmse — never falls back to the fold mean', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        predictionsKey: 'predictions.parquet',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
        holdoutMetrics: { r2: 0.91 },
      }),
      trainingRun({ id: 'run-b', metrics: { rmse: 0.6 } }),
    ]
    renderStep(store => setupNoJob(store))

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('0.600')).toBeInTheDocument()
    expect(screen.getByText('Holdout RMSE')).toBeInTheDocument()
    expect(screen.queryByText('0.400 ± 0.050')).not.toBeInTheDocument()
  })

  // Advisor-found gap, 2026-09-04: the SOLE-selectable-run pass-through
  // (`SingleRunSummary`) reads a DIFFERENT source (`selectedRun` built into
  // `DraftTrainingResult`) than `StandaloneRunRow`'s table does — the two
  // components must still agree about the SAME run once it has been scored,
  // reachable via Step 4 -> Evaluation -> score -> back to Step 4.
  it('the single-run pass-through shows Holdout RMSE, never the fold mean, once the sole run has been scored — must agree with the comparison table', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        predictionsKey: 'predictions.parquet',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
        holdoutMetrics: { rmse: 0.35, r2: 0.91 },
      }),
    ]
    h.selectionResult.selectedRunId = 'run-cv'
    renderStep(store => setupNoJob(store))

    expect(screen.getByText(/Holdout RMSE 0\.350\./)).toBeInTheDocument()
    // The old "score it" note must not survive into the scored state — that
    // was the exact disagreement this test guards against.
    expect(
      screen.queryByText(/estimate of the configuration/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/RMSE 0\.400 ± 0\.050/)).not.toBeInTheDocument()
  })

  it('the single-run pass-through still shows the fold-mean estimate and "score it" note while the sole run is awaiting scoring — unchanged pre-T06 behaviour', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05, n_splits: 5 },
      }),
    ]
    h.selectionResult.selectedRunId = 'run-cv'
    renderStep(store => setupNoJob(store))

    expect(
      screen.getByText(/RMSE 0\.400 ± 0\.050 across 5 folds\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Score it against the holdout in Evaluation/),
    ).toBeInTheDocument()
  })

  it('the single-run pass-through shows a running-scoring note while the sole run’s scoring container is in flight', () => {
    h.runsResult.runs = [
      trainingRun({
        id: 'run-cv',
        cvFoldsKey: 'cv_folds.json',
        scoringContainerId: 'container-1',
        metrics: { cv_rmse_mean: 0.4, cv_rmse_std: 0.05 },
      }),
    ]
    h.selectionResult.selectedRunId = 'run-cv'
    renderStep(store => setupNoJob(store))

    expect(
      screen.getByText(/Scoring against the holdout is running/),
    ).toBeInTheDocument()
  })
})
