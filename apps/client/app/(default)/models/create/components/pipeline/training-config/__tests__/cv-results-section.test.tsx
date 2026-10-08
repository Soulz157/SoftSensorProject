import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { mpServerDraftIdAtom } from '@/store/model-pipeline'
import { CvRunSection } from '../cv-results-section'
import { RunParamsPanel } from '../run-params-panel'
import type {
  CvFoldRecord,
  ModelTrainingRunListItem,
  RunCvFolds,
  RunPredictionsBatchItem,
} from '@/services/model-draft'

const h = vi.hoisted(() => ({
  predictions: {
    byRunId: new Map(),
    loading: false,
    error: null as string | null,
  },
  folds: { byRunId: new Map(), loading: false },
  /** Every (runIds, population) the prediction hook was asked for. */
  asked: [] as { runIds: string[]; population: string }[],
  job: null as { bestRunId: string | null; nSplits?: number | null } | null,
  runsResult: {
    runs: [] as ModelTrainingRunListItem[],
    loading: false,
    error: null as string | null,
    refetch: () => {},
  },
}))

vi.mock('@/hooks/model/use-candidate-predictions', () => ({
  useCandidatePredictions: (
    _d: string,
    runIds: string[],
    population: string,
  ) => {
    h.asked.push({ runIds, population })
    return h.predictions
  },
}))
vi.mock('@/hooks/model/use-run-cv-folds', () => ({
  useRunCvFolds: () => h.folds,
}))
vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.runsResult,
}))
vi.mock('@/hooks/model/use-candidate-job', () => ({
  useCandidateJob: () => ({
    job: h.job,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))
vi.mock('@/hooks/model/use-draft-selection', () => ({
  useDraftSelection: () => ({
    selectedRunId: null,
    loading: false,
    refetch: () => {},
  }),
}))
// The chart's own logic is `lib/cv-oof.test.ts`'s subject; recharts needs a
// laid-out container jsdom does not provide.
vi.mock('../cv-oof-chart', () => ({
  CvOofChart: () => <div data-testid="oof-chart" />,
}))

function foldRecord(n: number): CvFoldRecord {
  return {
    fold: n,
    cut_timestamp: `2026-01-0${n} 00:00:00`,
    train_rows: 100 * n,
    test_rows: 50,
    distinct: 12,
    r2: 0.8,
    rmse: 1.5,
    mae: 1.1,
    train_r2: 0.9,
    train_rmse: 1,
    train_mae: 0.8,
  }
}

const cvFolds: RunCvFolds = {
  algorithm: 'ridge',
  n_splits: 3,
  folds: [foldRecord(1), foldRecord(2), foldRecord(3)],
}

function run(
  overrides: Partial<ModelTrainingRunListItem> = {},
): ModelTrainingRunListItem {
  return {
    id: 'run-cv',
    status: 'SUCCEEDED',
    failureReason: null,
    datasetId: 'ds-1',
    goldArtifactId: 'art-1',
    artifactChecksum: 'sha256:abc',
    featureSpecKey: 'feature_spec.json',
    featureColumns: null,
    sweepId: null,
    sweepSeedRunId: null,
    targetY: 'TI-101',
    algorithm: 'ridge',
    hyperparameters: {},
    seed: 1,
    // The shared split-spec type has no cv_expanding variant (a deliberate,
    // recorded gap — lib/run-comparison.ts), so the real wire shape is cast.
    splitSpec: {
      method: 'cv_expanding',
      n_splits: 3,
    } as unknown as ModelTrainingRunListItem['splitSpec'],
    imageDigest: 'sha256:01',
    modelKey: 'model.joblib',
    metrics: {
      n_splits: 3,
      cv_r2_mean: 0.8123,
      cv_r2_std: 0.0411,
      cv_rmse_mean: 1.5,
      cv_rmse_std: 0.25,
      cv_mae_mean: 1.1,
      cv_mae_std: 0.1,
    },
    holdoutMetrics: null,
    cvFoldsKey: 'drafts/d/runs/run-cv/cv_folds.json',
    featureImportanceKey: null,
    permutationImportanceKey: null,
    predictionsKey: null,
    holdoutPredictionsKey: null,
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

const oofItem: RunPredictionsBatchItem = {
  runId: 'run-cv',
  sourceKey: 'drafts/d/runs/run-cv/cv_oof_predictions.parquet',
  rowCount: 2,
  residualSd: 0.5,
  residualRmseCheck: 0.5,
  yTrueMin: 1,
  yTrueMax: 2,
  yPredMin: 1,
  yPredMax: 2,
  points: [
    { timestamp: '2026-01-01 01:00:00', yTrue: 1, yPred: 1.1 },
    { timestamp: '2026-01-02 01:00:00', yTrue: 2, yPred: 1.9 },
  ],
  downsampled: false,
  error: null,
}

beforeEach(() => {
  h.predictions = {
    byRunId: new Map([['run-cv', oofItem]]),
    loading: false,
    error: null,
  }
  h.folds = { byRunId: new Map([['run-cv', cvFolds]]), loading: false }
  h.asked = []
  h.runsResult.runs = []
  h.job = null
})

describe('CvRunSection (MODEL-FLOW-028, in the card since MODEL-FLOW-029)', () => {
  it('shows fold score as mean ± std, the OOF chart and the per-fold table', () => {
    render(<CvRunSection draftId="d" run={run()} />)

    expect(screen.getByText('Cross-validation — 3 folds')).toBeTruthy()
    expect(screen.getByText('0.812 ± 0.041')).toBeTruthy()
    expect(screen.getByText('1.500 ± 0.250')).toBeTruthy()
    expect(screen.getByTestId('oof-chart')).toBeTruthy()
    expect(screen.getByText('Per-fold configuration metrics')).toBeTruthy()
  })

  it('asks for this one run’s out-of-fold population, never test or holdout', () => {
    render(<CvRunSection draftId="d" run={run()} />)
    expect(h.asked.length).toBeGreaterThan(0)
    for (const call of h.asked) {
      expect(call.population).toBe('cv-oof')
      expect(call.runIds).toEqual(['run-cv'])
    }
  })

  it('says the figures describe the configuration, not the saved refit', () => {
    render(<CvRunSection draftId="d" run={run()} />)
    expect(screen.getByText(/not the refit that gets saved/)).toBeTruthy()
  })

  it('states the absence for a run trained before OOF was saved, and keeps the scores', () => {
    h.predictions = {
      byRunId: new Map([
        ['run-cv', { ...oofItem, points: [], error: 'object not found' }],
      ]),
      loading: false,
      error: null,
    }
    render(<CvRunSection draftId="d" run={run()} />)

    expect(screen.queryByTestId('oof-chart')).toBeNull()
    expect(screen.getByText(/Retrain to see this chart/)).toBeTruthy()
    expect(screen.getByText('0.812 ± 0.041')).toBeTruthy()
    expect(screen.getByText('Per-fold configuration metrics')).toBeTruthy()
  })

  it('does not fabricate a fold table when cv_folds.json is unreadable', () => {
    h.folds = { byRunId: new Map([['run-cv', null]]), loading: false }
    render(<CvRunSection draftId="d" run={run()} />)

    expect(screen.queryByText('Per-fold configuration metrics')).toBeNull()
    expect(screen.getByText(/Per-fold figures could not be read/)).toBeTruthy()
    expect(screen.queryByTestId('oof-chart')).toBeNull()
    expect(screen.getByText('0.812 ± 0.041')).toBeTruthy()
  })

  it('uses no status colours on the fold scores (red/amber are reserved)', () => {
    const { container } = render(<CvRunSection draftId="d" run={run()} />)
    const scoreTiles = container.querySelector('.grid-cols-3')
    expect(scoreTiles?.innerHTML).not.toMatch(/red|amber|emerald/)
  })
})

describe('A CV run in the normal run card (MODEL-FLOW-029-T03)', () => {
  function renderPanel(runs: ModelTrainingRunListItem[]) {
    h.runsResult.runs = runs
    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    return render(
      <Provider store={store}>
        <RunParamsPanel />
      </Provider>,
    )
  }

  it('heads the card with the CV score and a k-fold chip, never "rmse —"', () => {
    renderPanel([run()])
    expect(screen.getByText('cv rmse')).toBeTruthy()
    // METRIC_META.rmse.format: two decimals.
    expect(screen.getByText('1.50 ± 0.25')).toBeTruthy()
    expect(screen.getByText('3-fold CV')).toBeTruthy()
  })

  it('a normal run keeps its plain rmse header and no CV chip', () => {
    renderPanel([
      run({
        id: 'run-plain',
        cvFoldsKey: null,
        splitSpec: { method: 'chronological', ratio: 0.7 },
        metrics: { r2: 0.9, rmse: 1.234 },
      }),
    ])
    expect(screen.queryByText('cv rmse')).toBeNull()
    expect(screen.queryByText(/-fold CV/)).toBeNull()
    expect(screen.getByText('1.23')).toBeTruthy()
  })

  it('shows the Cross-validation section inside the open (latest) card', () => {
    renderPanel([run()])
    expect(screen.getByText('Cross-validation — 3 folds')).toBeTruthy()
    expect(screen.getByTestId('oof-chart')).toBeTruthy()
  })

  it('a collapsed card fetches nothing; opening it fetches that run alone', () => {
    // The first (latest) card opens by default; the second starts collapsed.
    renderPanel([run({ id: 'run-new' }), run({ id: 'run-old' })])
    const fetched = () => new Set(h.asked.flatMap(c => c.runIds))
    expect(fetched()).toEqual(new Set(['run-new']))

    const toggles = screen.getAllByRole('button', { name: 'Show run detail' })
    fireEvent.click(toggles[0]!)
    expect(fetched()).toEqual(new Set(['run-new', 'run-old']))
    for (const call of h.asked) expect(call.runIds).toHaveLength(1)
  })

  it('no longer renders the separate CV block below the cards', () => {
    renderPanel([run()])
    // One section — the card's own — not a second copy beneath the list.
    expect(screen.getAllByText(/^Cross-validation/)).toHaveLength(1)
  })

  it('marks the search winner "best", titled with the CV rule it won by', () => {
    h.job = { bestRunId: 'run-b', nSplits: 3 }
    renderPanel([run({ id: 'run-a' }), run({ id: 'run-b' })])
    const badges = screen.getAllByText('best')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.getAttribute('title')).toBe(
      'Lowest mean cross-validated RMSE in this search.',
    )
  })

  it('shows no "best" badge without a search', () => {
    renderPanel([run()])
    expect(screen.queryByText('best')).toBeNull()
  })
})
