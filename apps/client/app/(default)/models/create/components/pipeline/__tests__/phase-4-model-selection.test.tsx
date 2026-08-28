import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { Phase4ModelSelection } from '../phase-4-model-selection'
import {
  mpCandidateJobIdAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import type { CandidateResult, ModelCandidateJob } from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

const h = vi.hoisted(() => ({
  result: {
    job: null as ModelCandidateJob | null,
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
}))

vi.mock('@/hooks/model/use-candidate-job', () => ({
  useCandidateJob: () => h.result,
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
  NAV.goTo = vi.fn()
})

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
      })
      store.set(mpCandidateJobIdAtom, 'job-1')
    })

    expect(screen.queryByText('Sweep')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Tuning /)).not.toBeInTheDocument()
  })
})
