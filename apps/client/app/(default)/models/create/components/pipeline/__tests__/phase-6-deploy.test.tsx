import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import { Phase6Deploy } from '../phase-6-deploy'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import type { DraftRunSummary } from '@/hooks/model/use-draft-run-evaluation'

/**
 * MODEL-FLOW-016-T12. Two things the Save screen must not do for a
 * Cross-Validation run:
 *
 *  - print a train/test split. A CV run has no single cut, so `80 / 20` here
 *    describes a split that never happened — the "looks like success" class
 *    this feature's findings keep naming.
 *  - stay silent about an unscored one. Scoring is draft-scoped
 *    (`assertDraftWritable` refuses a SAVED draft), so saving is the point of
 *    no return: the model ships with fold metrics and no held-out score of
 *    its own, permanently.
 *
 * A plain run's rendering must be untouched, which is what the last cases are
 * for — a CV branch that also changed the ordinary path would pass both CV
 * assertions and still be wrong.
 */

const h = vi.hoisted(() => ({
  result: {
    run: null as DraftRunSummary | null,
    fit: null as unknown,
    manifest: null as unknown,
    loading: false,
    error: null as string | null,
    triggerScoring: async () => {},
  },
}))

// `cvScoringPhaseOf` stays REAL (importOriginal) — it is the pure derivation
// this component's warning is keyed off, and re-mocking it would test the
// mock. Only the network-backed half of the module is faked, same discipline
// as phase-3-evaluation.test.tsx.
vi.mock('@/hooks/model/use-draft-run-evaluation', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/hooks/model/use-draft-run-evaluation')
    >()
  return {
    ...actual,
    useDraftRunEvaluation: () => h.result,
  }
})

vi.mock('@/hooks/model/use-model-commit', () => ({
  useModelCommit: () => async () => 'model-1',
}))
vi.mock('@/hooks/use-all-models', () => ({
  useRefreshModels: () => () => {},
}))
vi.mock('@/services/model', () => ({ updateModel: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const NAV = {
  goTo: vi.fn(),
  selectedDataset: { id: 'ds-1', name: 'Boiler dataset' },
  targetVariables: ['S204FBP.lab'],
  algorithms: ['ols'],
  trainTestSplit: 80,
  findBestModel: false,
  findBestParams: false,
} as unknown as UsePipelineNavResult

const BASE_RUN: DraftRunSummary = {
  id: 'run-1',
  status: 'SUCCEEDED',
  algorithm: 'ols',
  targetY: 'S204FBP.lab',
  failureReason: null,
  cvFoldsKey: null,
  predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
  scoringContainerId: null,
  holdoutMetrics: null,
  cvFolds: null,
}

const CV_FOLDS = {
  algorithm: 'ols',
  n_splits: 3,
  folds: [1, 2, 3].map(fold => ({
    fold,
    cut_timestamp: '2026-02-05T14:15:00.000Z',
    train_rows: 2089 * fold,
    test_rows: 2087,
    distinct: 32,
    r2: 0.4,
    rmse: 0.5,
    mae: 0.4,
    train_r2: 0.5,
    train_rmse: 0.4,
    train_mae: 0.3,
  })),
}

function renderPhase6() {
  const store = createStore()
  store.set(mpServerDraftIdAtom, 'draft-1')
  store.set(mpTrainingResultAtom, {
    runId: 'run-1',
    algorithm: 'ols',
    metrics: null,
    trainedAt: '2026-09-02T00:00:00.000Z',
    cvFoldsKey: null,
  })
  return render(
    <Provider store={store}>
      <Phase6Deploy nav={NAV} />
    </Provider>,
  )
}

describe('Phase6Deploy — a Cross-Validation run', () => {
  beforeEach(() => {
    h.result.run = null
  })

  it('names the fold plan instead of a train/test split it never had', () => {
    h.result.run = {
      ...BASE_RUN,
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      predictionsKey: null,
      cvFolds: CV_FOLDS,
    }
    renderPhase6()

    expect(screen.getByText(/3 expanding folds/i)).toBeInTheDocument()
    expect(screen.queryByText('80 / 20')).not.toBeInTheDocument()
    expect(screen.queryByText('Train / Test split')).not.toBeInTheDocument()
  })

  it('still tells the truth when cv_folds.json has not loaded — no k, no fallback to the split', () => {
    h.result.run = {
      ...BASE_RUN,
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      predictionsKey: null,
      cvFolds: null,
    }
    renderPhase6()

    // Exact, not a loose regex: the unscored warning below also says
    // "cross-validation", so a substring match would pass on the warning
    // alone while the review row still printed a split.
    expect(
      screen.getByText('Cross-validation — expanding folds'),
    ).toBeInTheDocument()
    expect(screen.queryByText('80 / 20')).not.toBeInTheDocument()
  })

  it('warns that an unscored CV run can never be scored after saving, without blocking Save', () => {
    h.result.run = {
      ...BASE_RUN,
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      predictionsKey: null,
      cvFolds: CV_FOLDS,
    }
    renderPhase6()

    expect(
      screen.getByText(/scoring cannot be run after saving/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /back to evaluation/i }),
    ).toBeInTheDocument()
    // Non-blocking: the consequence is stated, the decision stays the user's.
    expect(screen.getByRole('button', { name: /save model/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /save & deploy/i })).toBeEnabled()
  })

  it('drops the warning once the run has been scored — the fold row stays', () => {
    h.result.run = {
      ...BASE_RUN,
      cvFoldsKey: 'drafts/draft-1/runs/run-1/cv_folds.json',
      predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
      holdoutMetrics: { r2: -4.536, mae: 0.181, rmse: 0.21 },
      cvFolds: CV_FOLDS,
    }
    renderPhase6()

    expect(screen.getByText(/3 expanding folds/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/scoring cannot be run after saving/i),
    ).not.toBeInTheDocument()
  })

  it('leaves an ordinary run’s review exactly as it was — split row, no warning', () => {
    h.result.run = BASE_RUN
    renderPhase6()

    expect(screen.getByText('Train / Test split')).toBeInTheDocument()
    expect(screen.getByText('80 / 20')).toBeInTheDocument()
    expect(screen.queryByText(/cross-validation/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/scoring cannot be run after saving/i),
    ).not.toBeInTheDocument()
  })

  it('shows no CV surface at all when there is no run — edit mode, and a draft that never trained', () => {
    h.result.run = null
    renderPhase6()

    expect(screen.getByText('Train / Test split')).toBeInTheDocument()
    expect(
      screen.queryByText(/scoring cannot be run after saving/i),
    ).not.toBeInTheDocument()
  })
})
