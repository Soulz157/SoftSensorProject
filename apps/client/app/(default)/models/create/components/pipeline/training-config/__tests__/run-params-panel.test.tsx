import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpAlgorithmAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import { RunParamsPanel } from '../run-params-panel'
import type { ModelTrainingRunListItem } from '@/services/model-draft'

/**
 * MODEL-FLOW-012-V04. Only `useDraftRuns` (the network hook) is mocked —
 * `useApplyRunParams` and `lib/run-params` run for real against the test's
 * own jotai store, so an Apply click here proves the same raw-setter path
 * V01/V03 pin at the hook level actually wires up through the rendered UI.
 */
const h = vi.hoisted(() => ({
  result: {
    runs: [] as ModelTrainingRunListItem[],
    loading: false,
    error: null as string | null,
    refetch: () => {},
  },
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.result,
}))

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
  Object.assign(h.result, { runs, loading: false, error: null })
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
  h.result.runs = []
  h.result.loading = false
  h.result.error = null
  h.result.refetch = () => {}
})

describe('RunParamsPanel (MODEL-FLOW-012)', () => {
  it('renders an honest empty state when the draft has no run yet', () => {
    renderPanel([])
    expect(screen.getByText(/No training run yet/i)).toBeInTheDocument()
  })

  it('refetches when trainState.status changes — the panel stays mounted through the whole training cycle and nothing else remounts it when a run finishes', () => {
    const refetch = vi.fn()
    h.result.refetch = refetch
    const { store } = renderPanel([])
    refetch.mockClear()

    act(() => {
      store.set(mpTrainStateAtom, { status: 'training', progress: 0 })
    })
    expect(refetch).toHaveBeenCalledTimes(1)

    act(() => {
      store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    })
    expect(refetch).toHaveBeenCalledTimes(2)
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

  it('renders a CANCELED run with no failure reason, without fabricating one', () => {
    renderPanel([
      run({ status: 'CANCELED', failureReason: null, metrics: null }),
    ])
    expect(screen.getByText('Canceled')).toBeInTheDocument()
    expect(screen.queryByText(/—/)).not.toBeInTheDocument()
  })

  it('disables Apply while the run is non-terminal (QUEUED/RUNNING) but still shows its parameters', () => {
    renderPanel([run({ status: 'RUNNING', metrics: null })])
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Ridge Regression')).toBeInTheDocument()
    expect(
      screen.getByText('Apply to Training Config').closest('button'),
    ).toBeDisabled()
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
    Object.assign(h.result, {
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

    expect(screen.getByText(/not in the current dataset/i)).toBeInTheDocument()
    expect(
      screen.getByText(/isn't a tag on the currently selected dataset/i),
    ).toBeInTheDocument()
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
