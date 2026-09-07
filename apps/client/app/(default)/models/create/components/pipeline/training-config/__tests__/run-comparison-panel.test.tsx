import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { RunComparisonPanel } from '../run-comparison-panel'
import type { ModelTrainingRunListItem } from '@/services/model-draft'

// The overlay's own data is `candidate-overlay-chart`'s subject and its
// series come from a batch fetch this panel merely forwards — stubbed to an
// empty map so the chart takes its honest `entries.length === 0` early
// return and the table below is what these cases actually assert on.
vi.mock('@/hooks/model/use-candidate-predictions', () => ({
  useCandidatePredictions: () => ({
    byRunId: new Map(),
    loading: false,
    error: null,
  }),
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
    metrics: { r2: 0.9, rmse: 1.234, mae: 0.987 },
    holdoutMetrics: null,
    cvFoldsKey: null,
    predictionsKey: null,
    scoringContainerId: null,
    lossHistoryKey: null,
    splitStats: null,
    candidateJobId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    startedAt: '2026-08-27T00:00:01.000Z',
    finishedAt: '2026-08-27T00:00:30.000Z',
    ...overrides,
  }
}

function renderPanel(runs: ModelTrainingRunListItem[]) {
  const store = createStore()
  return render(
    <Provider store={store}>
      <RunComparisonPanel draftId="draft-1" runs={runs} />
    </Provider>,
  )
}

const ridgeRun = run({ id: 'run-1', algorithm: 'ridge' })
const forestRun = run({
  id: 'run-2',
  algorithm: 'random_forest',
  metrics: { r2: 0.95, rmse: 0.876, mae: 0.654 },
})
const twoRuns = [ridgeRun, forestRun]

describe('RunComparisonPanel (MODEL-FLOW-021)', () => {
  it('states which source ordered the list, once, above the table', () => {
    renderPanel(twoRuns)
    expect(screen.getByText('Ranked by Test RMSE.')).toBeInTheDocument()
  })

  it('ranks on the metric, best first — a DISPLAY order, not the run list order', () => {
    renderPanel(twoRuns)
    const rows = screen.getAllByRole('row')
    // rows[0]/rows[1] are the two header rows; the first body row is the
    // better RMSE (random_forest, 0.876) even though ridge came in first.
    expect(
      within(rows[2] as HTMLElement).getByText('Random Forest'),
    ).toBeInTheDocument()
    expect(
      within(rows[3] as HTMLElement).getByText('Ridge Regression'),
    ).toBeInTheDocument()
  })

  it('renders RMSE, MAE and R² — the metrics a run card never showed', () => {
    renderPanel(twoRuns)
    expect(screen.getByText('1.234')).toBeInTheDocument()
    expect(screen.getByText('0.987')).toBeInTheDocument()
    expect(screen.getByText('0.900')).toBeInTheDocument()
  })

  it('gives every metric TWO source columns and never merges them into one', () => {
    renderPanel(twoRuns)
    // The point is the SHAPE: each selected metric spans exactly two source
    // sub-columns, the first of which is the run's own test split. Asserted
    // structurally rather than on the second column's label, which is being
    // renamed Holdout -> Validate elsewhere in the wizard as this lands and
    // is not a claim this test needs to take a side on.
    //
    // 3 row-spanning headers (#, Algorithm, Status) + 1 group header per
    // metric + 2 sub-headers per metric = 3 + 4 + 8 = 15 for the four
    // metrics the picker selects by default.
    expect(screen.getAllByRole('columnheader')).toHaveLength(15)
    expect(screen.getAllByText('Test')).toHaveLength(4)
  })

  it('renders an absent holdout figure as an em dash, never as 0.000', () => {
    renderPanel(twoRuns)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('0.000')).not.toBeInTheDocument()
  })

  it('renders `sd` as n/a rather than blank — no run-row source carries it', () => {
    renderPanel(twoRuns)
    expect(screen.getAllByText('n/a')).toHaveLength(4)
    // …and its header is not a sort target.
    expect(screen.queryByTitle(/Rank by Residual SD/i)).not.toBeInTheDocument()
  })

  it('sections two targets separately — one sorted column never spans both', () => {
    renderPanel([
      run({ id: 'run-1', targetY: 'TI-101' }),
      run({ id: 'run-2', targetY: 'FI-202', algorithm: 'random_forest' }),
    ])
    expect(screen.getByText('y = TI-101')).toBeInTheDocument()
    expect(screen.getByText('y = FI-202')).toBeInTheDocument()
    // Two groups means two independent rankings, each with its own sentence.
    expect(screen.getAllByText('Ranked by Test RMSE.')).toHaveLength(2)
  })

  it('adds no target header for the ordinary single-target draft', () => {
    renderPanel(twoRuns)
    expect(screen.queryByText('y = TI-101')).not.toBeInTheDocument()
  })

  it('keeps a FAILED run in the table, unranked, with its reason — never dropped', () => {
    renderPanel([
      ridgeRun,
      run({
        id: 'run-3',
        algorithm: 'random_forest',
        status: 'FAILED',
        failureReason: 'container OOM',
        metrics: null,
      }),
    ])
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('container OOM')).toBeInTheDocument()
    expect(screen.getByTitle('Did not finish')).toBeInTheDocument()
  })

  it('refuses the Test column to a CV run rather than showing its fold estimate there', () => {
    renderPanel([
      ridgeRun,
      run({
        id: 'run-4',
        algorithm: 'random_forest',
        cvFoldsKey: 'folds.json',
        metrics: {
          cv_rmse_mean: 1.1,
          cv_rmse_std: 0.2,
          cv_r2_mean: 0.8,
          cv_mae_mean: 0.9,
          n_splits: 5,
        },
      }),
    ])
    expect(
      screen.getAllByText('N/A — cross-validation').length,
    ).toBeGreaterThan(0)
  })

  it('names what makes a row a different comparison, without refusing it', () => {
    renderPanel([
      ridgeRun,
      run({
        id: 'run-5',
        algorithm: 'random_forest',
        goldArtifactId: 'art-2',
        metrics: { r2: 0.95, rmse: 0.876, mae: 0.654 },
      }),
    ])
    expect(
      screen.getAllByText(/different dataset artifact/i).length,
    ).toBeGreaterThan(0)
    // Both rows still ranked — a named difference is a label, not a block.
    expect(screen.getByText('Ranked by Test RMSE.')).toBeInTheDocument()
  })
})
