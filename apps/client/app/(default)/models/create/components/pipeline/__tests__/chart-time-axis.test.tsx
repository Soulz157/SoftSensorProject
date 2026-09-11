import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
// MODEL-FLOW-019-T20 follow-up. The heading WORD is read from the source of
// truth rather than spelled here: `populationTitle` is display vocabulary and
// has already been respelled once mid-flight ('Holdout' -> 'Validate', to
// match METRIC_SOURCE_LABELS). What these tests actually pin is WHICH
// population each panel names, which survives any rewording; a hardcoded
// literal would fail for a copy edit that broke nothing.
import { populationTitle } from '@/lib/metric-source'
import { createStore, Provider } from 'jotai'
import { parse } from 'date-fns'
import {
  CandidateOverlayChart,
  buildOverlayRows,
  type OverlaySeries,
} from '../model-selection/candidate-overlay-chart'
import { ActualVsPredictedChart } from '../evaluation/actual-vs-predicted-chart'
import { ResidualChart } from '../evaluation/residual-chart'
import { buildFitRows, type FitPoint } from '@/lib/model-metrics'
import { pickTimeFormat } from '@/lib/monitoring'
import {
  mpCandidateJobIdAtom,
  mpCompareRunIdsAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import { Phase4ModelSelection } from '../phase-4-model-selection'
import { RunParamsPanel } from '../training-config/run-params-panel'
import type {
  CandidateResult,
  ModelCandidateJob,
  ModelTrainingRunListItem,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import type { ArtifactHoldout } from '@/services/dataset-version'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

/**
 * MODEL-FLOW-019-T19. V32/V33/V34 — the three regression items T19's audit
 * owed once it closed with "no defect": the charts were already right, but
 * nothing proved it, and nothing proved the stale-compare-id and merge
 * guards T08/T17 documented in comments actually hold.
 */

const h = vi.hoisted(() => ({
  jobResult: {
    job: null as ModelCandidateJob | null,
    loading: false,
    error: null as string | null,
    refetch: vi.fn(),
  },
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
  predictionsResult: {
    byRunId: new Map<string, RunPredictionsBatchItem>(),
    loading: false,
    error: null as string | null,
  },
  /** MODEL-FLOW-019-T20. The holdout population's own series, empty unless a
   *  case opts in — a run that has never been scored has none, and that is
   *  the common shape. */
  holdoutPredictionsResult: {
    byRunId: new Map<string, RunPredictionsBatchItem>(),
    loading: false,
    error: null as string | null,
  },
  /** MODEL-FLOW-019-T20 follow-up. `StandaloneComparison`'s own
   *  `useArtifactHoldout` call — mocked rather than let run for real, the
   *  same reason every other data hook here is: this component makes NO
   *  network request of its own in a render test, and the real hook would
   *  fire one (jsdom's own `fetch`) that resolves after this test's
   *  synchronous assertions already ran, leaving an unhandled rejection
   *  behind. `holdout: null` with no `missing`/`error` is the hook's own
   *  documented "not recorded" default. */
  artifactHoldoutResult: {
    holdout: null as ArtifactHoldout | null,
    loading: false,
    missing: false,
    error: null as string | null,
  },
  predictionsSpy: vi.fn(),
}))

vi.mock('@/hooks/model/use-candidate-job', () => ({
  useCandidateJob: () => h.jobResult,
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => h.runsResult,
}))

vi.mock('@/hooks/model/use-draft-selection', () => ({
  useDraftSelection: () => h.selectionResult,
}))

vi.mock('@/hooks/dataset/artifact/use-artifact-holdout', () => ({
  useArtifactHoldout: () => h.artifactHoldoutResult,
}))

// Wraps the fetch hook so the assertion can see exactly which runIds every
// consumer requested, not only what it rendered — V33 requires both.
// MODEL-FLOW-019-T20. Population-AWARE, because Step 4 now calls this hook
// twice per path (test + holdout) and a blind mock would hand the same test
// series to both charts — making the holdout overlay render test data under
// a Holdout heading, i.e. staging the exact conflation these tests exist to
// catch. `holdoutPredictionsResult` is empty by default, which is the real
// shape for the many runs never scored against a holdout.
vi.mock('@/hooks/model/use-candidate-predictions', () => ({
  useCandidatePredictions: (
    draftId: string,
    runIds: string[],
    population: 'test' | 'holdout' = 'test',
  ) => {
    h.predictionsSpy(draftId, runIds, population)
    return population === 'holdout'
      ? h.holdoutPredictionsResult
      : h.predictionsResult
  },
}))

vi.mock('@/services/model-draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/model-draft')>()
  return {
    ...actual,
    modelDraftCandidateJobService: {
      ...actual.modelDraftCandidateJobService,
      select: vi.fn().mockResolvedValue({}),
    },
    modelDraftService: {
      ...actual.modelDraftService,
      selectRun: vi.fn().mockResolvedValue({}),
    },
  }
})

const NAV = { goTo: vi.fn() } as unknown as UsePipelineNavResult

// ---------------------------------------------------------------------------
// V32 — rendered ticks fall inside the fixture's own window, not the input
// array. The real observed window from T19's repro: draft 8d9370cc, run
// d1520372, splitSpec cut_timestamp "2026-02-21 12:55:00" -> dataset end
// "2026-02-27 08:00:00". Timestamps use the server's own wire form (space
// separated, no zone — artifact_service.py's isoformat(sep=" ")), matching
// phase-3-evaluation.test.tsx rather than the "...Z" form lib/monitoring
// .test.tsx uses — mixing the two would make the assertion turn on the
// runner's own timezone instead of on the axis.
// ---------------------------------------------------------------------------

const WINDOW_START = '2026-02-21 12:55:00'
const WINDOW_END = '2026-02-27 08:00:00'
const WINDOW_TIMESTAMPS = [
  WINDOW_START,
  '2026-02-22 12:00:00',
  '2026-02-23 12:00:00',
  '2026-02-24 12:00:00',
  '2026-02-25 12:00:00',
  WINDOW_END,
]
const WINDOW_MIN_MS = Date.parse(WINDOW_START)
const WINDOW_MAX_MS = Date.parse(WINDOW_END)
const DAY_MS = 24 * 60 * 60 * 1000

function fitPoints(): FitPoint[] {
  return WINDOW_TIMESTAMPS.map((timestamp, i) => {
    const actual = 0.5 + i * 0.01
    const predicted = actual + (i % 2 === 0 ? 0.02 : -0.02)
    return { timestamp, actual, predicted, residual: actual - predicted }
  })
}

function batchItem(
  runId: string,
  yPredOffset: number,
): RunPredictionsBatchItem {
  return {
    runId,
    sourceKey: `predictions/${runId}.parquet`,
    rowCount: WINDOW_TIMESTAMPS.length,
    residualSd: 0.02,
    residualRmseCheck: 0.02,
    yTrueMin: 0.5,
    yTrueMax: 0.55,
    yPredMin: 0.48,
    yPredMax: 0.57,
    points: WINDOW_TIMESTAMPS.map((timestamp, i) => ({
      timestamp,
      yTrue: 0.5 + i * 0.01,
      yPred: 0.5 + i * 0.01 + yPredOffset,
    })),
    downsampled: false,
    error: null,
  }
}

/** X-axis tick label text, in DOM order — `.recharts-xAxis` scopes out the
 *  Y axis' own `.recharts-cartesian-axis-tick-value` nodes, which share the
 *  same class. */
/**
 * recharts 3.8 does NOT nest tick text under `.recharts-xAxis` the way the
 * tick LINES are — `CartesianAxis.js`'s tick-labels group renders inside a
 * `ZIndexLayer`, which portals its children (`react-dom`'s `createPortal`)
 * into a separate `<g class="recharts-zIndex-layer_N">` elsewhere in the
 * same SVG, specifically so label z-ordering can cross axis boundaries.
 * Both axes' `recharts-cartesian-axis-tick-value` text nodes land in that
 * SAME portal, indistinguishable by DOM ancestry. Every chart here draws
 * its Y axis with a plain-decimal formatter (`v => Number(v).toFixed(1)`)
 * and its X axis with `pickTimeFormat`'s date pattern — `Number(label)` is
 * finite for the former and NaN for the latter, which is what separates
 * them.
 */
function xTickLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.recharts-cartesian-axis-tick-value'),
  )
    .map(el => el.textContent ?? '')
    .filter(label => label !== '' && Number.isNaN(Number(label)))
}

/**
 * The mandatory first assertion for every V32 case: without it, a chart
 * that measured 0x0 in jsdom and mounted no axis at all would pass every
 * later assertion vacuously (the trap `raw-readings-table.test.tsx`
 * documents for `@tanstack/react-virtual`'s own jsdom sizing problem).
 * Ticks are then parsed back through the SAME 'MMM d' pattern
 * `pickTimeFormat` chose for this span, against a fixed reference year —
 * the pattern carries no year, so the reference year is supplied rather
 * than left to `parse`'s own default (which is "now").
 */
function expectTicksWithinWindow(container: HTMLElement) {
  const labels = xTickLabels(container)
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) {
    const parsed = parse(label, 'MMM d', new Date(2026, 0, 1))
    expect(parsed.getTime()).toBeGreaterThanOrEqual(WINDOW_MIN_MS - DAY_MS)
    expect(parsed.getTime()).toBeLessThanOrEqual(WINDOW_MAX_MS + DAY_MS)
  }
}

describe('MODEL-FLOW-019-V32 — chart ticks stay inside the plotted window', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // recharts 3.8's ResponsiveContainer measures via BOTH a synchronous
    // `getBoundingClientRect()` read AND the ResizeObserver `contentRect`
    // this project's own vitest.setup.ts stub derives from that same call
    // (node_modules/recharts/es6/component/ResponsiveContainer.js:100-126)
    // — jsdom hardcodes it to a zero box, so one spy here covers both
    // paths. `offsetWidth`/`offsetHeight` (raw-readings-table.test.tsx's
    // own precedent) is the wrong property: recharts never reads it.
    //
    // A FLAT 800x220 for every element breaks tick selection rather than
    // fixing it: recharts' OWN text-measurer (`getStringSize`,
    // util/DOMUtils.js) measures each tick label by creating a hidden
    // `<span id="recharts_measurement_span">` and reading ITS
    // `getBoundingClientRect()` too. A flat mock makes every label report
    // as 800px wide, so the `minTickGap={40}` overlap check treats every
    // tick as colliding with the next one and prunes nearly all of them —
    // this is what produced 0 ticks on first pass, not a jsdom/recharts
    // incompatibility. The measurement span is special-cased by its own id
    // so its reported size scales with its actual text content.
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const isMeasurementSpan = this.id === 'recharts_measurement_span'
        const width = isMeasurementSpan
          ? Math.max(4, (this.textContent ?? '').length * 6)
          : 800
        const height = isMeasurementSpan ? 12 : 220
        return {
          width,
          height,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          x: 0,
          y: 0,
          toJSON() {
            return this
          },
        } as DOMRect
      })
  })

  afterEach(() => {
    rectSpy.mockRestore()
  })

  it('CandidateOverlayChart', () => {
    const candidates: OverlaySeries[] = [
      { runId: 'run-a', algorithm: 'ols' },
      { runId: 'run-b', algorithm: 'random_forest' },
    ]
    const byRunId = new Map<string, RunPredictionsBatchItem>([
      ['run-a', batchItem('run-a', 0.01)],
      ['run-b', batchItem('run-b', -0.01)],
    ])
    const { container } = render(
      <CandidateOverlayChart
        candidates={candidates}
        byRunId={byRunId}
        population="test-split"
      />,
    )
    expectTicksWithinWindow(container)
  })

  it('MODEL-FLOW-019-T20: names its own population, from the prop rather than a per-run guess', () => {
    // The conflation T20 closed: this chart used to caption every series as
    // an ordinary comparison with no source named. Deriving the source per
    // run does not fix it either — `populationOf(cvScoringPhaseOf(nonCv))`
    // is 'test-split' unconditionally, so a non-CV run's HOLDOUT series
    // would still read as Test. The population is therefore whatever the
    // caller fetched, stated once, and the same candidates render under
    // either heading depending only on which series were passed.
    const candidates: OverlaySeries[] = [{ runId: 'run-a', algorithm: 'ols' }]
    const byRunId = new Map<string, RunPredictionsBatchItem>([
      ['run-a', batchItem('run-a', 0.01)],
    ])

    const test = render(
      <CandidateOverlayChart
        candidates={candidates}
        byRunId={byRunId}
        population="test-split"
      />,
    )
    // Structural — the heading's exact markup is under live contention from
    // another party (see project memory on concurrent rewrites); assert the
    // word appears in the heading text, not its exact node shape.
    expect(test.container.textContent).toContain('Test-split')
    expect(test.container.textContent).toContain('on the test split')
    test.unmount()

    const holdout = render(
      <CandidateOverlayChart
        candidates={candidates}
        byRunId={byRunId}
        population="holdout"
        note="Holdout 12.5% missing (n=7)."
      />,
    )
    expect(holdout.container.textContent).toContain(populationTitle('holdout'))
    expect(holdout.container.textContent).toContain('on the validation holdout')
    // AC2 — a holdout chart never renders without its own missing rate.
    expect(holdout.container.textContent).toContain('12.5% missing')
  })

  it('MODEL-FLOW-019-T20: renders nothing when no candidate has that population', () => {
    // An unscored group's holdout chart must be absent, not an empty axis
    // implying a measurement that was never taken.
    const { container } = render(
      <CandidateOverlayChart
        candidates={[{ runId: 'run-a', algorithm: 'ols' }]}
        byRunId={new Map()}
        population="holdout"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('ActualVsPredictedChart', () => {
    const rows = buildFitRows(fitPoints(), 0.05)
    const tickFormatter = pickTimeFormat(WINDOW_MAX_MS - WINDOW_MIN_MS)
    const { container } = render(
      <ActualVsPredictedChart rows={rows} tickFormatter={tickFormatter} />,
    )
    expectTicksWithinWindow(container)
  })

  it('ResidualChart', () => {
    const rows = buildFitRows(fitPoints(), 0.05)
    const tickFormatter = pickTimeFormat(WINDOW_MAX_MS - WINDOW_MIN_MS)
    const { container } = render(
      <ResidualChart rows={rows} sd={0.05} tickFormatter={tickFormatter} />,
    )
    expectTicksWithinWindow(container)
  })

  it('sensitivity check: a chart genuinely off by +27 days fails this assertion', () => {
    // Proves the test above can actually detect the reported symptom rather
    // than passing on any input — shifts every timestamp by the exact
    // interval the original report described, off T19's own "25 Jan - 26
    // Jan referenced, 21 Feb - 27 Feb rendered" arithmetic.
    const SHIFT_MS = 27 * DAY_MS
    const shiftedPoints: FitPoint[] = fitPoints().map(p => ({
      ...p,
      timestamp: new Date(Date.parse(p.timestamp) - SHIFT_MS).toISOString(),
    }))
    const rows = buildFitRows(shiftedPoints, 0.05)
    const tickFormatter = pickTimeFormat(WINDOW_MAX_MS - WINDOW_MIN_MS)
    const { container } = render(
      <ActualVsPredictedChart rows={rows} tickFormatter={tickFormatter} />,
    )
    // Ticks must still exist — otherwise this "fails" for the vacuous
    // reason (nothing mounted), which is exactly the false pass V32 exists
    // to rule out, and would make this sensitivity check worthless.
    const labels = xTickLabels(container)
    expect(labels.length).toBeGreaterThan(0)
    expect(() => expectTicksWithinWindow(container)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// V33 — a compare id belonging to no run in the current draft/job must not
// silently narrow every consumer to zero. `mpCompareRunIdsAtom` is reset on
// draft resume/mount (store/model-pipeline.ts's resetWizardAtom) but not
// pruned reactively while mounted, so a stale id surviving a draft switch
// is the scenario each of the three independent intersections guards
// against. Asserted on what is PLOTTED, not only on what is requested: the
// job path computes its fetch runIds from job.candidates BEFORE narrowing
// (phase-4-model-selection.tsx), so a request-only assertion would miss a
// regression in the render-time filter.
// ---------------------------------------------------------------------------

const FOREIGN_RUN_ID = 'run-from-a-different-draft'

function candidateResult(
  overrides: Partial<CandidateResult> = {},
): CandidateResult {
  return {
    runId: 'run-a',
    algorithm: 'ols',
    hyperparameters: {},
    phase: 1,
    status: 'SUCCEEDED',
    failureReason: null,
    metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
    trainMetrics: { r2: 0.95, rmse: 0.3, mae: 0.2 },
    lossHistoryKey: null,
    lossHistory: null,
    predictionsKey: 'predictions.parquet',
    cvFoldsKey: null,
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    sourcedMetrics: [{ source: 'test-split', r2: 0.9, rmse: 0.5, mae: 0.4 }],
    holdoutAbsence: 'no-dataset-holdout',
    ...overrides,
  }
}

function candidateJob(
  overrides: Partial<ModelCandidateJob> = {},
): ModelCandidateJob {
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
    bestRunId: 'run-a',
    bestRmse: 0.5,
    selectedRunId: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    startedAt: '2026-08-28T00:00:01.000Z',
    finishedAt: '2026-08-28T00:00:30.000Z',
    candidates: [
      candidateResult({ runId: 'run-a', algorithm: 'ols' }),
      candidateResult({ runId: 'run-b', algorithm: 'random_forest' }),
    ],
    ...overrides,
  }
}

function trainingRun(
  overrides: Partial<ModelTrainingRunListItem> = {},
): ModelTrainingRunListItem {
  return {
    id: 'run-a',
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

beforeEach(() => {
  h.predictionsSpy.mockClear()
  h.jobResult.job = null
  h.runsResult.runs = []
  h.selectionResult.selectedRunId = null
  h.predictionsResult.byRunId = new Map()
  h.holdoutPredictionsResult.byRunId = new Map()
  h.artifactHoldoutResult.holdout = null
  h.artifactHoldoutResult.missing = false
  h.artifactHoldoutResult.error = null
})

describe('MODEL-FLOW-019-V33 — a foreign compare id plots nothing, empties nothing', () => {
  it('job path (CandidateComparison): both real candidates still render, the foreign id is never fetched', () => {
    h.jobResult.job = candidateJob()
    h.predictionsResult.byRunId = new Map([
      ['run-a', batchItem('run-a', 0.01)],
      ['run-b', batchItem('run-b', -0.01)],
    ])

    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    store.set(mpCandidateJobIdAtom, 'job-1')
    store.set(mpTrainingResultAtom, {
      runId: 'run-a',
      algorithm: 'ols',
      metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
      trainedAt: '2026-08-28T00:00:30.000Z',
      cvFoldsKey: null,
    })
    store.set(mpCompareRunIdsAtom, new Set([FOREIGN_RUN_ID]))

    render(
      <Provider store={store}>
        <Phase4ModelSelection nav={NAV} />
      </Provider>,
    )

    // Plotted: the overlay renders (would return null if narrowed to zero
    // candidates), and both real algorithm labels are on screen — an empty
    // "0 of 2" narrowing would show neither.
    // MODEL-FLOW-019-T20. The heading now names its population, and
    // there are two charts. Asserting the TEST-SPLIT one specifically
    // also proves the holdout chart did not render in its place with
    // test-split rows under it.
    //
    // MODEL-FLOW-019-T20 follow-up. This used to assert 'Holdout' was
    // ABSENT, which encoded the old behaviour: a holdout chart with no
    // series rendered nothing at all. That is exactly what made the user
    // report "only one chart shows" with no way to tell why. The holdout
    // panel now always renders and STATES its own emptiness, so the fact
    // worth pinning is no longer its absence but that it draws no series
    // and says so in words.
    // Structural (`document.body.textContent`, not `getAllByText`): the
    // holdout word ('Validate') also heads a CandidateTable column so is
    // not unique on screen, AND the overlay heading's exact markup is
    // under live contention from another party (see project memory on
    // concurrent rewrites) — asserting substring presence survives either.
    expect(document.body.textContent).toContain(populationTitle('test-split'))
    expect(document.body.textContent).toContain(populationTitle('holdout'))
    // The reason is DERIVED from these candidates, not a generic string:
    // this fixture's runs carry `holdoutAbsence: 'no-dataset-holdout'`, so
    // the panel must say the dataset has none — not "not scored yet",
    // which would send the reader to a scoring button that cannot help.
    expect(screen.getByText(/nothing to score against/i)).toBeInTheDocument()
    // getAllByText, not getByText: both the overlay chart's own legend AND
    // the candidate table render each algorithm's label, so more than one
    // match is the EXPECTED shape, not a duplicate-content bug.
    expect(screen.getAllByText('Linear Regression').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Random Forest').length).toBeGreaterThan(0)

    // Requested: the foreign id was never asked for, only the job's own two.
    expect(h.predictionsSpy).toHaveBeenCalled()
    const [, requestedIds] = h.predictionsSpy.mock.calls.at(-1) as [
      string,
      string[],
    ]
    expect(requestedIds.sort()).toEqual(['run-a', 'run-b'])
    expect(requestedIds).not.toContain(FOREIGN_RUN_ID)
  })

  it('standalone path (StandaloneComparison): both real runs still render, the foreign id is never fetched', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a', algorithm: 'ols' }),
      trainingRun({ id: 'run-b', algorithm: 'random_forest' }),
    ]
    h.predictionsResult.byRunId = new Map([
      ['run-a', batchItem('run-a', 0.01)],
      ['run-b', batchItem('run-b', -0.01)],
    ])

    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    // No candidate job -> Phase4ModelSelection takes the standalone branch.
    store.set(mpTrainingResultAtom, {
      runId: 'run-a',
      algorithm: 'ols',
      metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
      trainedAt: '2026-08-27T00:00:30.000Z',
      cvFoldsKey: null,
    })
    store.set(mpCompareRunIdsAtom, new Set([FOREIGN_RUN_ID]))

    render(
      <Provider store={store}>
        <Phase4ModelSelection nav={NAV} />
      </Provider>,
    )

    // MODEL-FLOW-019-T20. The heading now names its population, and
    // there are two charts. Asserting the TEST-SPLIT one specifically
    // also proves the holdout chart did not render in its place with
    // test-split rows under it.
    //
    // MODEL-FLOW-019-T20 follow-up. This used to assert 'Holdout' was
    // ABSENT, which encoded the old behaviour: a holdout chart with no
    // series rendered nothing at all. That is exactly what made the user
    // report "only one chart shows" with no way to tell why. The holdout
    // panel now always renders and STATES its own emptiness, so the fact
    // worth pinning is no longer its absence but that it draws no series
    // and says so in words.
    // Structural, unlike a `getAllByText` count: the standalone path
    // groups runs by target, and every group now renders BOTH population
    // panels — an empty one states its reason instead of vanishing — so
    // "Test-split" is expected more than once, but the overlay heading's
    // exact markup is under live contention from another party (see
    // project memory on concurrent rewrites), so presence is what this
    // asserts rather than an exact node shape.
    expect(document.body.textContent).toContain(populationTitle('test-split'))
    expect(document.body.textContent).toContain(populationTitle('holdout'))
    // A DIFFERENT branch from the job path above, and deliberately so: this
    // fixture's runs carry no `holdoutMetrics` and `artifactHoldoutResult`
    // defaults to `holdout: null` (the mocked `useArtifactHoldout`'s own
    // "not recorded" case — see its own doc comment above), so
    // `holdoutAbsenceOf` reads `not-recorded`. At the SERIES layer
    // (`holdoutSeriesAbsenceOf`) that collapses into the same actionable
    // bucket as a confirmed "not scored yet": either way scoring is the
    // next action, so the panel offers it — never the job path's "nothing
    // to score against", which would send the reader to a button that
    // cannot help.
    // MODEL-FLOW-019-T29. `groupAbsenceText`'s aggregate-only/not-scored-yet
    // copy collapsed to one sentence — see that function's own comment.
    expect(
      screen.getAllByText(/scored against the validation holdout/i).length,
    ).toBeGreaterThan(0)
    // ...and offers the fix: both runs are SUCCEEDED with no series and no
    // confirmed absence, so `scoreableRunIds` names both and the panel
    // renders a Score button rather than a dead-end sentence alone.
    expect(
      screen.getByRole('button', {
        name: /score 2 candidates against holdout/i,
      }),
    ).toBeInTheDocument()
    // getAllByText, not getByText: both the overlay chart's own legend AND
    // the candidate table render each algorithm's label, so more than one
    // match is the EXPECTED shape, not a duplicate-content bug.
    expect(screen.getAllByText('Linear Regression').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Random Forest').length).toBeGreaterThan(0)

    expect(h.predictionsSpy).toHaveBeenCalled()
    const [, requestedIds] = h.predictionsSpy.mock.calls.at(-1) as [
      string,
      string[],
    ]
    expect(requestedIds.sort()).toEqual(['run-a', 'run-b'])
    expect(requestedIds).not.toContain(FOREIGN_RUN_ID)
  })

  it('RunParamsPanel: the footer still reads "all N runs", not narrowed to zero', () => {
    h.runsResult.runs = [
      trainingRun({ id: 'run-a' }),
      trainingRun({ id: 'run-b' }),
    ]

    const store = createStore()
    store.set(mpServerDraftIdAtom, 'draft-1')
    store.set(mpCompareRunIdsAtom, new Set([FOREIGN_RUN_ID]))

    render(
      <Provider store={store}>
        <RunParamsPanel />
      </Provider>,
    )

    // "all 2 runs" (the empty-set-means-everything wording), never a "0 of
    // 2" narrowing that a raw, unintersected read of the atom would produce.
    expect(screen.getByText(/all 2 runs?/i)).toBeInTheDocument()
    expect(screen.queryByText(/0 of 2/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// V34 — two runs whose decimated timestamps do NOT coincide keep their own
// x value in the merge, and no row is dropped without being counted. Two
// series that already share every timestamp would pass an index-based
// merge too and prove nothing — these fixtures are deliberately disjoint.
// ---------------------------------------------------------------------------

describe('MODEL-FLOW-019-V34 — non-coincident overlay timestamps merge by key, not by index', () => {
  it('each series keeps its own x value; the merged row count is the union, nothing dropped', () => {
    const runA = {
      runId: 'run-a',
      item: {
        ...batchItem('run-a', 0.01),
        points: [
          { timestamp: '2026-02-21 12:55:00', yTrue: 0.5, yPred: 0.51 },
          { timestamp: '2026-02-22 12:55:00', yTrue: 0.52, yPred: 0.53 },
          { timestamp: '2026-02-23 12:55:00', yTrue: 0.54, yPred: 0.55 },
        ],
      },
    }
    const runB = {
      runId: 'run-b',
      item: {
        ...batchItem('run-b', -0.01),
        points: [
          // Disjoint from run-a's timestamps — an index merge
          // (`rows[i]` <-> `other[i]`) would align row 0 of each series
          // onto one shared x and silently pass; a key merge cannot.
          { timestamp: '2026-02-21 18:00:00', yTrue: 0.5, yPred: 0.49 },
          { timestamp: '2026-02-24 06:00:00', yTrue: 0.56, yPred: 0.57 },
        ],
      },
    }
    const entries = [runA, runB]

    const rows = buildOverlayRows(entries)

    // Union of both series' timestamps — 3 + 2, all distinct. A dropped
    // row (silently discarded rather than merged) would read fewer.
    expect(rows).toHaveLength(5)

    const byTimestamp = new Map(rows.map(r => [r.timestamp, r]))

    // run-a's own timestamps carry run-a's prediction and no run-b value.
    for (const p of runA.item.points) {
      const row = byTimestamp.get(p.timestamp)
      expect(row).toBeDefined()
      expect(row?.['pred_run-a']).toBe(p.yPred)
      expect(row?.['pred_run-b']).toBeUndefined()
    }
    // run-b's own timestamps carry run-b's prediction and no run-a value.
    for (const p of runB.item.points) {
      const row = byTimestamp.get(p.timestamp)
      expect(row).toBeDefined()
      expect(row?.['pred_run-b']).toBe(p.yPred)
      expect(row?.['pred_run-a']).toBeUndefined()
    }

    // Sorted by time, ascending — the merge does not preserve input order.
    const times = rows.map(r => r.t)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
