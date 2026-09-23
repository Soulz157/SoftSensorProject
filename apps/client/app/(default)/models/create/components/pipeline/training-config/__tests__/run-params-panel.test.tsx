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
import type { ModelTrainingRunListItem } from '@/services/model-draft'

/**
 * MODEL-FLOW-012-V04 / MODEL-FLOW-018-T03, then MODEL-FLOW-019-T08. Only
 * the network hooks (`useDraftRuns`, `useDraftSelection`) and
 * `modelDraftService.selectRun` are mocked — `useApplyRunParams` runs for
 * real against the test's own jotai store, so an Apply click here proves
 * the raw-setter path actually wires up through the rendered UI, not just
 * through a mock. `useCandidateJob` is NOT mocked here any more: T08
 * deleted the panel's only caller of it (the carry-forward picker's
 * job-liveness gate), so the real component no longer imports that hook at
 * all.
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
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.runsResult,
}))

vi.mock('@/hooks/model/use-draft-selection', () => ({
  useDraftSelection: () => h.selectionResult,
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
    // MODEL-FLOW-019-T31: an ordinary run trains on every column and
    // belongs to no sweep.
    featureColumns: null,
    sweepId: null,
    sweepSeedRunId: null,
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
    featureImportanceKey: null,
    permutationImportanceKey: null,
    predictionsKey: null,
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    lossHistoryKey: null,
    // MODEL-FLOW-020-T04. Null by default, so every pre-existing case here
    // exercises the panel's absent-sidecar branch; the dedicated block below
    // overrides it to assert the rendered figures.
    splitStats: null,
    candidateJobId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    startedAt: '2026-08-27T00:00:01.000Z',
    finishedAt: '2026-08-27T00:00:30.000Z',
    ...overrides,
  }
}

/**
 * The footer's "Nothing ticked — comparing…" sentence splits across a bare
 * text node and a `<span>` sibling (the count is styled distinctly) — a
 * plain `getByText(exactString)` compares against the whole `<p>`'s
 * `textContent`, which concatenates JSX whitespace RTL's normalizer does
 * not fully re-collapse after the fact. Re-normalizing manually here
 * sidesteps that, rather than asserting on JSX's own whitespace output.
 */
function getByNormalizedText(text: string) {
  return screen.getByText(
    (_, element) =>
      element?.tagName === 'P' &&
      (element.textContent ?? '').replace(/\s+/g, ' ').trim() === text,
  )
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
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled()
  })

  // MODEL-FLOW-021. A FAILED run enables Apply (retry with its params) but
  // must refuse Compare — it produced no metrics, so it has nothing to put in
  // either the table or the overlay.
  it('renders a FAILED run with Compare disabled and its own stated reason, while Apply stays enabled', () => {
    renderPanel([
      run({ status: 'FAILED', failureReason: 'container OOM', metrics: null }),
    ])
    expect(
      screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
    ).toBeDisabled()
    expect(
      screen.getByText(/didn't succeed.*no metrics to compare/i),
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

  it('disables Apply and Compare while the run is non-terminal (QUEUED/RUNNING) but still shows its parameters', () => {
    renderPanel([run({ status: 'RUNNING', metrics: null })])
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Ridge Regression')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
    ).toBeDisabled()
    expect(
      screen.getByText(/Available once this run finishes/i),
    ).toBeInTheDocument()
  })

  // MODEL-FLOW-019-T34. The label is lowercase `rmse` since 991ff47 put the
  // headline metric in the collapsed card header, where it sits beside the
  // status and the timestamp rather than heading a tile of its own.
  it('shows RMSE only for a SUCCEEDED run with recorded metrics', () => {
    renderPanel([run()])
    expect(screen.getByText('rmse')).toBeInTheDocument()
    expect(screen.getByText('1.23')).toBeInTheDocument()
  })

  it('labels a hyperparameter build_model does not read for that algorithm as "unused"', () => {
    renderPanel([
      run({
        algorithm: 'random_forest',
        hyperparameters: { n_estimators: 100, max_features: 0.5 },
      }),
    ])
    // `max_features` is a real RandomForestRegressor argument that build_model
    // does not pass, so it is the unconsumed one — it replaced
    // `min_samples_leaf`, which MODEL-FLOW-026 made genuinely consumed.
    // random_forest also CONSUMES the seed, so the seed chip carries no marker
    // here and `getByText` (singular) is the right query — a second `unused` on
    // screen would fail this outright.
    expect(screen.getByText('unused')).toBeInTheDocument()
  })

  it("Apply writes the run's values into the raw atoms, never the current form's algorithm", () => {
    const { store } = renderPanel([run()])
    store.set(mpAlgorithmAtom, 'svm')

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

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

  /**
   * MODEL-FLOW-020-T04. The two dataset size figures a past run was sized
   * against, shown beside the hyperparameters a user can Apply.
   *
   * The fixture is the real measured pair from this system (8,350 rows
   * holding 32 distinct labelled values) rather than two similar numbers:
   * asserting both means a panel that rendered the row count twice, or
   * swapped the two, fails here instead of looking plausible.
   */
  describe('MODEL-FLOW-020-T04: what a run was sized against', () => {
    it('shows BOTH the row count and the distinct labelled count', () => {
      renderPanel([
        run({
          splitStats: { source_rows: 8350, distinct_labelled_values: 32 },
        }),
      ])

      expect(screen.getByText(/8,350 rows/)).toBeInTheDocument()
      expect(screen.getByText(/32 distinct/)).toBeInTheDocument()
    })

    it('shows neither when the run carries no frozen sidecar', () => {
      renderPanel([run({ splitStats: null })])

      // Silence, not a zero: a run launched before MODEL-FLOW-014 — or one
      // whose fire-and-forget freeze never landed — has no figure to show,
      // and "0 rows" would be a claim about the dataset rather than about
      // the record.
      expect(screen.queryByText(/distinct/)).not.toBeInTheDocument()
      expect(screen.queryByText(/rows ·/)).not.toBeInTheDocument()
    })
  })

  // MODEL-FLOW-018-T02's finding: target mismatch is a WARNING, never a
  // refusal — Compare must still be enabled here.
  it('warns but does NOT refuse Compare on a target/dataset mismatch', () => {
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
      screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
    ).not.toBeDisabled()
  })

  // MODEL-FLOW-021. The checkbox is a VIEW control: it writes no server
  // state, so a compare click must not reach `selectRun` at all. The old
  // Select's own invariant (no relock — Apply remains the only relock
  // trigger) is preserved here for the footer picker instead.
  it('checking Compare writes nothing to the server and changes no trainState/highestUnlocked', async () => {
    const { store } = renderPanel([run()])
    store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    store.set(mpHighestUnlockedAtom, 3)
    const trainStateBefore = store.get(mpTrainStateAtom)
    const highestBefore = store.get(mpHighestUnlockedAtom)

    fireEvent.click(
      screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
      ).toBeChecked(),
    )
    expect(mockSelectRun).not.toHaveBeenCalled()
    expect(store.get(mpTrainStateAtom)).toEqual(trainStateBefore)
    expect(store.get(mpHighestUnlockedAtom)).toBe(highestBefore)
  })

  // MODEL-FLOW-019-T08 (resolved 2026-09-07) REVERSED MODEL-FLOW-021's own
  // footer design: no picker, no Select, no destination promise — the
  // wizard shell's forward button is the ONLY control that advances Step 3
  // -> Step 4, gated by `canAdvance(3)`. This panel writes no step atom at
  // all, from any state (a selection existing or not).
  it('never writes mpCurrentStepAtom/mpHighestUnlockedAtom — the wizard shell owns the only move to Step 4', () => {
    h.selectionResult.selectedRunId = 'run-1'
    const { store } = renderPanel([run()])

    expect(
      screen.queryByText('Compare in Model Selection'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Use this run')).not.toBeInTheDocument()
    expect(store.get(mpCurrentStepAtom)).toBe(1)
    expect(store.get(mpHighestUnlockedAtom)).toBe(1)
  })

  // MODEL-FLOW-021 AC6. The phrase is retired from this step — asserted, not
  // merely intended, because it survived in three doc comments and one test
  // name after the control it described was gone.
  it('never says "carrying forward" anywhere in the panel', () => {
    h.selectionResult.selectedRunId = 'run-1'
    renderPanel([run()])
    expect(screen.queryByText(/carrying forward/i)).not.toBeInTheDocument()
  })

  // MODEL-FLOW-019-T08 (resolved 2026-09-07): "AN EMPTY COMPARE SET MEANS
  // EVERY RUN, AND THE FOOTER SAYS SO." Step 3's footer reports the COUNT
  // of runs ticked and nothing else — no picker, no Select, no destination
  // promise. The comparison TABLE itself now lives in Step 4
  // (phase-4-model-selection.test.tsx), which reads the same
  // `mpCompareRunIdsAtom` this panel writes — this describe block owns only
  // the count line and the checkbox's own write-nothing guarantee.
  describe('compare set (MODEL-FLOW-019-T08)', () => {
    const twoRuns = () => [
      run({ id: 'run-1', algorithm: 'ridge' }),
      run({ id: 'run-2', algorithm: 'random_forest' }),
    ]

    it('renders no footer bar until the draft has at least one terminal run', () => {
      renderPanel([])
      expect(
        screen.queryByText(/selected to compare|Nothing ticked/),
      ).not.toBeInTheDocument()
    })

    it('reports "comparing all" when nothing is ticked', () => {
      renderPanel(twoRuns())
      expect(
        getByNormalizedText('Nothing ticked — comparing all 2 runs'),
      ).toBeInTheDocument()
    })

    it('ticking a box narrows the count, and un-ticking the last one restores compare-all', () => {
      renderPanel(twoRuns())

      fireEvent.click(
        screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
      )
      expect(screen.getByText('1 of 2')).toBeInTheDocument()

      fireEvent.click(
        screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
      )
      expect(
        getByNormalizedText('Nothing ticked — comparing all 2 runs'),
      ).toBeInTheDocument()
    })

    it('checking a box writes no server state — the checkbox is a view control, never Select', () => {
      renderPanel(twoRuns())
      fireEvent.click(
        screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
      )
      expect(mockSelectRun).not.toHaveBeenCalled()
    })

    it('the "Compare all" button clears the set back to every run', () => {
      renderPanel(twoRuns())
      fireEvent.click(
        screen.getByRole('checkbox', { name: /Compare Ridge Regression/i }),
      )
      expect(screen.getByText('1 of 2')).toBeInTheDocument()

      fireEvent.click(screen.getAllByText('Compare all')[0]!)
      expect(
        getByNormalizedText('Nothing ticked — comparing all 2 runs'),
      ).toBeInTheDocument()
    })
  })

  /**
   * MODEL-FLOW-014-T07/V06, re-established by MODEL-FLOW-019-T34 after
   * 991ff47 redesigned the panel into cards.
   *
   * BOTH DIRECTIONS, and both as POSITIVE assertions. The seed is now ONE
   * provenance chip reading `seed 4242` — never a 'Seed' label beside a
   * separate '4242' value — and the difference between an algorithm that
   * consumes it and one that does not is carried by an `unused` marker on
   * that chip, not by the chip's presence. T34 rejected inverting these to
   * `queryByText(...).not.toBeInTheDocument()`: an absent chip cannot
   * distinguish "this estimator ignores the seed" from "the chip stopped
   * rendering", and only the first is a fact about the run.
   *
   * The two cases must disagree on the marker, or it is unfalsified — a
   * panel that always marked (or never marked) would pass a one-sided test.
   * BOTH scope the assertion to the seed chip rather than to the document:
   * the shared fixture carries `{alpha: 0.037}`, which random_forest does
   * NOT read, so a bare `queryByText('unused')` would match that
   * hyperparameter's own marker and report the seed's state wrongly.
   */
  it('shows the seed chip with NO unused marker for an algorithm that consumes it (random_forest)', () => {
    renderPanel([run({ algorithm: 'random_forest', seed: 4242 })])
    const chip = screen.getByText('seed 4242').closest('span[title]')
    expect(chip).not.toHaveTextContent('unused')
    expect(chip).toHaveAttribute(
      'title',
      'Estimator seed — this algorithm consumes it.',
    )
  })

  it('shows the seed chip MARKED unused for ridge, which train.py never passes random_state to', () => {
    renderPanel([run({ algorithm: 'ridge', seed: 4242 })])
    const chip = screen.getByText('seed 4242').closest('span[title]')
    expect(chip).toHaveTextContent('unused')
    // The marker alone would not say WHY. The title names the estimator, the
    // same sentence the unconsumed-hyperparameter chips carry.
    expect(chip).toHaveAttribute(
      'title',
      'Ridge Regression does not read the seed — it had no effect on the fit.',
    )
  })
})
