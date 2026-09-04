import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpAlgorithmAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import { RunParamsPanel } from '../run-params-panel'
import { modelDraftService } from '@/services/model-draft'
import type {
  ModelCandidateJob,
  ModelTrainingRunListItem,
} from '@/services/model-draft'

/**
 * MODEL-FLOW-012-V04 / MODEL-FLOW-018-T03. Only the network hooks
 * (`useDraftRuns`, `useDraftSelection`, `useCandidateJob`) and
 * `modelDraftService.selectRun` are mocked — `useApplyRunParams` and
 * `useModelPipelineNav` run for real against the test's own jotai store, so
 * an Apply/Select-footer click here proves the same raw-setter / nav path
 * actually wires up through the rendered UI, not just through a mock.
 */
const h = vi.hoisted(() => ({
  runsResult: {
    runs: [] as ModelTrainingRunListItem[],
    loading: false,
    error: null as string | null,
    refetch: () => {},
  },
  selectionResult: {
    selectedRunId: null as string | null,
    loading: false,
    refetch: () => {},
  },
  jobResult: {
    job: null as ModelCandidateJob | null,
    loading: false,
    error: null as string | null,
    refetch: () => {},
  },
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.runsResult,
}))

vi.mock('@/hooks/model/use-draft-selection', () => ({
  useDraftSelection: () => h.selectionResult,
}))

vi.mock('@/hooks/model/use-candidate-job', () => ({
  useCandidateJob: () => h.jobResult,
}))

vi.mock('@/services/model-draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/model-draft')>()
  return {
    ...actual,
    modelDraftService: {
      ...actual.modelDraftService,
      selectRun: vi.fn(),
    },
  }
})

const mockSelectRun = modelDraftService.selectRun as Mock

function run(
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
    metrics: { r2: 0.9, rmse: 1.234 },
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

function renderPanel(runs: ModelTrainingRunListItem[]) {
  Object.assign(h.runsResult, { runs, loading: false, error: null })
  const store = createStore()
  store.set(mpServerDraftIdAtom, 'draft-1')
  return {
    store,
    ...render(
      <Provider store={store}>
        <RunParamsPanel />
      </Provider>,
    ),
  }
}

beforeEach(() => {
  h.runsResult.runs = []
  h.runsResult.loading = false
  h.runsResult.error = null
  h.runsResult.refetch = () => {}
  h.selectionResult.selectedRunId = null
  h.selectionResult.loading = false
  h.selectionResult.refetch = () => {}
  h.jobResult.job = null
  h.jobResult.loading = false
  h.jobResult.error = null
  h.jobResult.refetch = () => {}
  mockSelectRun.mockReset()
  mockSelectRun.mockResolvedValue({
    statusCode: 200,
    message: 'ok',
    type: 'SUCCESS',
    data: {},
  })
})

describe('RunParamsPanel (MODEL-FLOW-012)', () => {
  it('renders an honest empty state when the draft has no run yet', () => {
    renderPanel([])
    expect(screen.getByText(/No training run yet/i)).toBeInTheDocument()
  })

  it('refetches runs AND selection when trainState.status changes — the panel stays mounted through the whole training cycle and nothing else remounts it when a run finishes', () => {
    const refetch = vi.fn()
    const refetchSelection = vi.fn()
    h.runsResult.refetch = refetch
    h.selectionResult.refetch = refetchSelection
    const { store } = renderPanel([])
    refetch.mockClear()
    refetchSelection.mockClear()

    act(() => {
      store.set(mpTrainStateAtom, { status: 'training', progress: 0 })
    })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refetchSelection).toHaveBeenCalledTimes(1)

    act(() => {
      store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    })
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(refetchSelection).toHaveBeenCalledTimes(2)
  })

  it('renders a FAILED run naming the reason and enables Apply — a terminal run', () => {
    renderPanel([
      run({ status: 'FAILED', failureReason: 'container OOM', metrics: null }),
    ])
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/container OOM/)).toBeInTheDocument()
    expect(
      screen.getByText('Apply to Training Config').closest('button'),
    ).not.toBeDisabled()
  })

  // MODEL-FLOW-018-T03. A FAILED run enables Apply (retry with its params)
  // but must refuse Select — nothing succeeded, nothing to carry forward.
  it('renders a FAILED run with Select disabled and its own stated reason, while Apply stays enabled', () => {
    renderPanel([
      run({ status: 'FAILED', failureReason: 'container OOM', metrics: null }),
    ])
    expect(screen.getByText('Select').closest('button')).toBeDisabled()
    expect(
      screen.getByText(/didn't succeed.*nothing to carry forward/i),
    ).toBeInTheDocument()
  })

  it('renders a CANCELED run with no failure reason, without fabricating one', () => {
    const { container } = renderPanel([
      run({ status: 'CANCELED', failureReason: null, metrics: null }),
    ])
    expect(screen.getByText('Canceled')).toBeInTheDocument()
    // The destructive-styled paragraph (`{run.failureReason && <p
    // className="text-destructive">...}`) is the only place a failure
    // reason renders — querying its class directly proves the conditional
    // held, rather than a string match that could never fail regardless.
    expect(container.querySelector('.text-destructive')).toBeNull()
  })

  it('disables Apply and Select while the run is non-terminal (QUEUED/RUNNING) but still shows its parameters', () => {
    renderPanel([run({ status: 'RUNNING', metrics: null })])
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Ridge Regression')).toBeInTheDocument()
    expect(
      screen.getByText('Apply to Training Config').closest('button'),
    ).toBeDisabled()
    expect(screen.getByText('Select').closest('button')).toBeDisabled()
    expect(
      screen.getByText(/Available once this run finishes/i),
    ).toBeInTheDocument()
  })

  it('shows RMSE only for a SUCCEEDED run with recorded metrics', () => {
    renderPanel([run()])
    expect(screen.getByText('RMSE')).toBeInTheDocument()
    expect(screen.getByText('1.23')).toBeInTheDocument()
  })

  it('labels a hyperparameter build_model does not read for that algorithm as "not used"', () => {
    renderPanel([
      run({
        algorithm: 'random_forest',
        hyperparameters: { n_estimators: 100, min_samples_leaf: 5 },
      }),
    ])
    expect(screen.getByText('not used')).toBeInTheDocument()
  })

  it("Apply writes the run's values into the raw atoms, never the current form's algorithm", () => {
    const { store } = renderPanel([run()])
    store.set(mpAlgorithmAtom, 'svm')

    fireEvent.click(screen.getByText('Apply to Training Config'))

    expect(store.get(mpAlgorithmAtom)).toBe('ridge')
    expect(
      screen.getByText(/Applied Ridge Regression's parameters/),
    ).toBeInTheDocument()
  })

  it("names a run's target that isn't a tag on the currently selected dataset — a run outlives the dataset selection that produced it", () => {
    Object.assign(h.runsResult, {
      runs: [run({ targetY: 'TI-999' })],
      loading: false,
      error: null,
    })
    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    store.set(mpSelectedDatasetAtom, {
      id: 'ds-1',
      name: 'Dataset 1',
      workspaceId: 'ws-1',
      currentArtifactId: 'art-1',
      tags: ['TI-101', 'TI-102'],
    } as SavedDataset)
    render(
      <Provider store={store}>
        <RunParamsPanel />
      </Provider>,
    )

    expect(
      screen.getByText(/isn't a tag on the currently selected dataset/i),
    ).toBeInTheDocument()
  })

  // MODEL-FLOW-018-T02's finding: target mismatch is a WARNING for Select,
  // never a refusal — Select must still be enabled here.
  it('warns but does NOT refuse Select on a target/dataset mismatch', () => {
    Object.assign(h.runsResult, {
      runs: [run({ targetY: 'TI-999' })],
      loading: false,
      error: null,
    })
    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    store.set(mpSelectedDatasetAtom, {
      id: 'ds-1',
      name: 'Dataset 1',
      workspaceId: 'ws-1',
      currentArtifactId: 'art-1',
      tags: ['TI-101', 'TI-102'],
    } as SavedDataset)
    render(
      <Provider store={store}>
        <RunParamsPanel />
      </Provider>,
    )

    expect(screen.getByText('Select').closest('button')).not.toBeDisabled()
  })

  // MODEL-FLOW-018 openDecision, MODEL-FLOW-014-V07's own mirrored proof:
  // Select must not relock — Apply remains the only relock trigger.
  it('Select changes no trainState/highestUnlocked and never fires Apply’s commit path', async () => {
    const { store } = renderPanel([run()])
    store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    store.set(mpHighestUnlockedAtom, 3)
    const trainStateBefore = store.get(mpTrainStateAtom)
    const highestBefore = store.get(mpHighestUnlockedAtom)

    fireEvent.click(screen.getByText('Select'))
    await waitFor(() => expect(mockSelectRun).toHaveBeenCalledTimes(1))

    expect(store.get(mpTrainStateAtom)).toEqual(trainStateBefore)
    expect(store.get(mpHighestUnlockedAtom)).toBe(highestBefore)
    expect(mockSelectRun).toHaveBeenCalledWith('draft-1', 'run-1')
  })

  // MODEL-FLOW-012-T11's deferred job-level rule, discharged by
  // MODEL-FLOW-018-T03: a SUCCEEDED run whose own candidate job is still
  // QUEUED/RUNNING is not selectable.
  it('disables Select, naming the job, for a SUCCEEDED run whose candidate job is still RUNNING', () => {
    h.jobResult.job = {
      id: 'job-1',
      modelDraftId: 'draft-1',
      targetY: 'TI-101',
      goldArtifactId: 'art-1',
      trainTestSplit: null,
      kind: 'ALGORITHM_SWEEP',
      totalRuns: 2,
      completedRuns: 1,
      status: 'RUNNING',
      failureReason: null,
      currentRunId: 'run-1',
      bestRunId: null,
      bestRmse: null,
      selectedRunId: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      startedAt: '2026-08-27T00:00:00.000Z',
      finishedAt: null,
      candidates: [],
    }
    renderPanel([run({ candidateJobId: 'job-1' })])

    expect(screen.getByText('Select').closest('button')).toBeDisabled()
    expect(
      screen.getByText(/candidate job is still running/i),
    ).toBeInTheDocument()
  })

  // A run belonging to an OLDER job (not the live one) is never blocked by
  // it — the (draftId)-scoped one-live-job index guarantees an older job is
  // already terminal.
  it('does not block Select for a run whose candidateJobId is NOT the live job', () => {
    h.jobResult.job = {
      id: 'job-2',
      modelDraftId: 'draft-1',
      targetY: 'TI-101',
      goldArtifactId: 'art-1',
      trainTestSplit: null,
      kind: 'ALGORITHM_SWEEP',
      totalRuns: 2,
      completedRuns: 1,
      status: 'RUNNING',
      failureReason: null,
      currentRunId: 'run-2',
      bestRunId: null,
      bestRmse: null,
      selectedRunId: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      startedAt: '2026-08-27T00:00:00.000Z',
      finishedAt: null,
      candidates: [],
    }
    renderPanel([run({ candidateJobId: 'job-1' })])

    expect(screen.getByText('Select').closest('button')).not.toBeDisabled()
  })

  // MODEL-FLOW-018 openDecision: mark-and-stay + footer CTA — the footer
  // renders only once a selection exists, and its CTA advances the wizard
  // the same way the bottom-nav Next control does (canAdvance(3) gated).
  // The CTA writes `mpCurrentStepAtom`/`mpHighestUnlockedAtom` DIRECTLY
  // (MODEL-FLOW-018-T03) rather than calling `useModelPipelineNav().next()`
  // — deliberately NOT presetting currentStep/highestUnlocked here, so this
  // proves the CTA lands on Step 4 from wherever the wizard actually is
  // (its default mount state: step 1, highestUnlocked 1), not only from a
  // hand-set "step 3, trainState done" precondition a stale `next()` closure
  // would have needed.
  it('renders the "Carrying forward" footer once a run is selected, and its CTA lands on and unlocks Step 4 regardless of the current step', () => {
    h.selectionResult.selectedRunId = 'run-1'
    const { store } = renderPanel([run()])

    // "Carrying forward" also labels the per-card badge — the footer's own
    // CTA text is the unambiguous proof the footer itself rendered.
    expect(screen.getByText('Compare in Model Selection')).toBeInTheDocument()
    expect(store.get(mpCurrentStepAtom)).toBe(1)
    expect(store.get(mpHighestUnlockedAtom)).toBe(1)

    fireEvent.click(screen.getByText('Compare in Model Selection'))
    expect(store.get(mpCurrentStepAtom)).toBe(4)
    expect(store.get(mpHighestUnlockedAtom)).toBeGreaterThanOrEqual(4)
  })

  it('renders no footer when nothing has been selected', () => {
    renderPanel([run()])
    expect(
      screen.queryByText('Compare in Model Selection'),
    ).not.toBeInTheDocument()
  })

  // MODEL-FLOW-014-T07/V06. Both directions, or the "not used by this
  // estimator" label is unfalsified — a panel that always shows the hint
  // (or never does) would pass a one-sided test.
  it('shows the seed value with NO hint for an algorithm that consumes it (random_forest)', () => {
    renderPanel([run({ algorithm: 'random_forest', seed: 4242 })])
    expect(screen.getByText('Seed')).toBeInTheDocument()
    expect(screen.getByText('4242')).toBeInTheDocument()
    expect(
      screen.queryByText(/not used by this estimator/i),
    ).not.toBeInTheDocument()
  })

  it('shows the seed value WITH "not used by this estimator" for ridge, which train.py never passes random_state to', () => {
    renderPanel([run({ algorithm: 'ridge', seed: 4242 })])
    expect(screen.getByText('Seed')).toBeInTheDocument()
    expect(screen.getByText('4242')).toBeInTheDocument()
    expect(screen.getByText(/not used by this estimator/i)).toBeInTheDocument()
  })
})
