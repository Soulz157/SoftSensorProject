import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import {
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import { Phase5Evaluation } from '../phase-5-evaluation'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import type {
  PopulationAbsence,
  PopulationEvaluation,
} from '@/hooks/model/use-draft-run-evaluation'
import type { EvaluationPopulation } from '@/lib/metric-source'

/**
 * MODEL-FLOW-004. Two failure modes a still-mocked client fit, or a
 * `pair`/`hasFit` left over from it, would each pass differently:
 *
 *  - digit-exact: proves the displayed R²/RMSE are the RUN's numbers, not a
 *    plausible-looking client computation.
 *  - renders-the-charts: the static-source guard (evaluation-contract.test.ts)
 *    proves the mock's CODE is gone; it cannot prove the replacement actually
 *    renders anything. `pair`/`hasFit` derived from removed dataset state
 *    would typecheck, pass an import-only check, and show blank space — this
 *    is the test that would fail for that.
 */

const h = vi.hoisted(() => ({
  result: {
    run: null as unknown,
    manifest: null as unknown,
    own: null as unknown,
    holdout: null as unknown,
    loading: false,
    error: null as string | null,
    triggerScoring: async () => {},
  },
}))

// MODEL-FLOW-016-T11. `cvScoringPhaseOf` is a pure derivation off `run` —
// kept real via `importOriginal` rather than re-mocked, so this file only
// fakes the network-backed half of the module (same discipline as every
// other hook mock in this suite: mock the fetch, not the module's own logic).
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

// MODEL-FLOW-019-T31. The /split-stats fallback the launcher uses when a run
// carries no frozen splitStats of its own — the case for 187 of this
// system's 260 SUCCEEDED runs.
const splitLookup = vi.hoisted(() => ({
  splitStats: null as { distinct_labelled_values: number } | null,
  loading: false,
  missing: null as string | null,
  refusal: null as string | null,
  error: null as string | null,
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-split-stats', () => ({
  useArtifactSplitStats: () => splitLookup,
}))
// `useRunDistinctLabelled` itself stays REAL — it is the pure prefer-frozen-
// else-lookup rule these tests are about, and mocking it would assert nothing.

const NAV = { goTo: vi.fn() } as unknown as UsePipelineNavResult

// Run 61f9aa28-0c31-4e99-bd52-4674200f72f6 — real values read from MinIO/DB
// this session (docs/... plan context), not invented.
const RUN = {
  status: 'SUCCEEDED' as const,
  algorithm: 'ols',
  targetY: 'S204FBP.lab',
  failureReason: null,
}
const METRICS = {
  r2: -2.406723649677836,
  rmse: 0.5259401632305729,
  // MODEL-FLOW-019-T04. Added when ModelMetrics widened to include `mae` —
  // an arbitrary but plausible value, not asserted on by any test here.
  mae: 0.31,
}
const POINTS = [
  {
    timestamp: '2026-02-08 00:46:00',
    actual: 0.224,
    predicted: 0.354308,
    residual: 0.224 - 0.354308,
  },
  {
    timestamp: '2026-02-08 00:56:00',
    actual: 0.224,
    predicted: 0.330366,
    residual: 0.224 - 0.330366,
  },
  {
    timestamp: '2026-02-08 01:06:00',
    actual: 0.224,
    predicted: 0.320072,
    residual: 0.224 - 0.320072,
  },
]

interface FitShape {
  r2: number
  rmse: number
  mae: number
  sd: number
  n: number
  points: typeof POINTS
}
interface ParityShape {
  yTrueMin: number
  yTrueMax: number
  yPredMin: number
  yPredMax: number
}

/** MODEL-FLOW-030. One population's evaluation, as the hook now returns it:
 *  tiles from `metrics` (present with or without a series), the series in
 *  `fit`, and a typed `absence` when there is none. */
function pop(
  population: EvaluationPopulation,
  fit: FitShape | null = null,
  parityRange: ParityShape | null = null,
  absence: PopulationAbsence | null = null,
  metrics: PopulationEvaluation['metrics'] = undefined as never,
): PopulationEvaluation {
  return {
    population,
    metrics:
      metrics !== (undefined as never)
        ? metrics
        : fit
          ? {
              r2: fit.r2,
              rmse: fit.rmse,
              mae: fit.mae,
              std: null,
              nSplits: null,
            }
          : null,
    fit,
    parityRange,
    absence: fit ? null : (absence ?? 'no-series'),
  }
}

interface StepOverrides {
  run?: unknown
  manifest?: unknown
  /** Shorthand for the run's OWN population series — the test split, or the
   *  out-of-fold series when the run carries a `cvFoldsKey`. */
  fit?: FitShape | null
  parityRange?: ParityShape | null
  own?: PopulationEvaluation | null
  holdout?: PopulationEvaluation | null
  loading?: boolean
  error?: string | null
}

function renderStep(overrides: StepOverrides = {}) {
  const run = (overrides.run ?? null) as {
    status?: string
    cvFoldsKey?: string | null
  } | null
  const succeeded = run?.status === 'SUCCEEDED'
  const isCv = Boolean(run?.cvFoldsKey)
  Object.assign(h.result, {
    run: overrides.run ?? null,
    manifest: overrides.manifest ?? null,
    own:
      overrides.own ??
      (succeeded
        ? pop(
            isCv ? 'cv-oof' : 'test-split',
            overrides.fit ?? null,
            overrides.parityRange ?? null,
          )
        : null),
    holdout: overrides.holdout ?? (succeeded ? pop('holdout', null) : null),
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
  })
  const store = createStore()
  store.set(mpServerDraftIdAtom, 'draft-1')
  store.set(mpTrainingResultAtom, {
    runId: 'run-1',
    algorithm: 'ols',
    metrics: METRICS,
    trainedAt: '2026-02-17T08:06:00.000Z',
    cvFoldsKey: null,
  })
  return render(
    <Provider store={store}>
      <Phase5Evaluation nav={NAV} />
    </Provider>,
  )
}

beforeEach(() => {
  NAV.goTo = vi.fn()
})

describe('Phase5Evaluation (MODEL-FLOW-004)', () => {
  it('shows the run metrics.json values, digit-exact — not a client-side fit', () => {
    renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })

    // Every metric card on this step reads 3 decimal places straight off
    // `fit` (`valueFor`'s own doc comment) — not `METRIC_META[key].format`,
    // which stays 2 digits for `run-params-panel.tsx`'s own use.
    expect(screen.getByText(METRICS.r2.toFixed(3))).toBeInTheDocument()
    expect(screen.getByText(METRICS.rmse.toFixed(3))).toBeInTheDocument()
    expect(screen.getByText(METRICS.mae.toFixed(3))).toBeInTheDocument()
    expect(screen.getByText((0.435277).toFixed(3))).toBeInTheDocument()
  })

  it('renders both charts and the diagnostics section when the run succeeded', () => {
    const { container } = renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })

    expect(
      screen.getByText('Actual vs predicted over time'),
    ).toBeInTheDocument()
    expect(screen.getByText('Residuals over time')).toBeInTheDocument()
    expect(
      screen.getByText('Test-split residual diagnostics'),
    ).toBeInTheDocument()
    // recharts renders an svg per chart even under a mocked ResponsiveContainer
    // in this project's test setup — presence proves the chart mounted, not
    // that the metric cards happened to render over blank chart space.
    expect(
      container.querySelectorAll('.recharts-wrapper, svg').length,
    ).toBeGreaterThan(0)
  })

  it('shows the algorithm and target from the RUN, not a client-computed pair', () => {
    renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText(/S204FBP\.lab/)).toBeInTheDocument()
  })

  it('renders an honest empty state when there is no run yet', () => {
    renderStep()
    expect(screen.getByText(/No training run yet/i)).toBeInTheDocument()
    expect(
      screen.queryByText('Actual vs predicted over time'),
    ).not.toBeInTheDocument()
  })

  it('renders an honest empty state for a still-training run', () => {
    renderStep({ run: { ...RUN, status: 'RUNNING' }, fit: null })
    expect(screen.getByText(/still running/i)).toBeInTheDocument()
  })

  it('renders an honest empty state for a FAILED run, naming the reason', () => {
    renderStep({
      run: { ...RUN, status: 'FAILED', failureReason: 'container OOM' },
      fit: null,
    })
    expect(screen.getByText(/container OOM/)).toBeInTheDocument()
  })

  it('names the target-derived feature count when the manifest reports one', () => {
    renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: ['lag_1'], targetScaled: false },
    })
    expect(screen.getByText(/1 target-derived feature/)).toBeInTheDocument()
  })
})

// MODEL-FLOW-019-T09. AC22-AC27 — top-10 ranking, the stated tail, the
// target-derived flag, and the unscaled-coefficient refusal.
describe('Phase5Evaluation feature importance (MODEL-FLOW-019-T09)', () => {
  const FIT = {
    r2: METRICS.r2,
    rmse: METRICS.rmse,
    mae: METRICS.mae,
    sd: 0.435277,
    n: POINTS.length,
    points: POINTS,
  }

  it('renders the top 10 of N with the stated tail — AC23', () => {
    const features = Array.from({ length: 21 }, (_, i) => ({
      name: `tag_${i}`,
      importance: 21 - i,
    }))
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'random_forest',
          method: 'impurity',
          standardized: null,
          scaling_methods: [],
          features,
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText(/Top 10 of 21 features/)).toBeInTheDocument()
    expect(screen.getByText('tag_0')).toBeInTheDocument()
    // Only the top 10 are LISTED, even though 21 exist.
    expect(screen.queryByText('tag_20')).not.toBeInTheDocument()
  })

  it('flags a target-derived feature where it ranks — AC24', () => {
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'random_forest',
          method: 'impurity',
          standardized: null,
          scaling_methods: [],
          features: [
            { name: 'lag_1', importance: 0.9 },
            { name: 'tag_1', importance: 0.1 },
          ],
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: ['lag_1'], targetScaled: false },
    })
    expect(screen.getByText('target-derived')).toBeInTheDocument()
  })

  it('refuses to rank an unscaled coefficient run and states why — AC27', () => {
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'ridge',
          method: 'coefficient',
          standardized: false,
          scaling_methods: [],
          features: [{ name: 'tag_1', importance: 0.4, coefficient: -0.4 }],
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText(/not ranked/)).toBeInTheDocument()
  })

  it('reads "not recorded for this run" when featureImportance is null — AC25', () => {
    renderStep({
      run: { ...RUN, featureImportance: null },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(
      screen.getByText(/Feature importance: not recorded for this run/),
    ).toBeInTheDocument()
  })

  // MODEL-FLOW-019-T32 / AC70. The method must be NAMED on screen and carry
  // its OWN caveat — the partial-effect one, never impurity's cardinality
  // wording, which is the whole reason METHOD_META is a table rather than a
  // sentence written inline in JSX.
  it('ranks a standardized-coefficient run under its own method name — AC70', () => {
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'ridge',
          method: 'standardized-coefficient',
          standardized: true,
          scaling_methods: [],
          features: [
            { name: 'tag_1', importance: 0.8, coefficient: 0.4 },
            { name: 'tag_2', importance: 0.2, coefficient: -0.4 },
          ],
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(
      screen.getByText(/Measured by standardized coefficient/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/per one standard deviation of its own input/),
    ).toBeInTheDocument()
    // It RANKS: the row is listed rather than refused...
    expect(screen.getByText('tag_1')).toBeInTheDocument()
    expect(screen.queryByText(/not ranked/)).not.toBeInTheDocument()
    // ...and it does NOT borrow impurity's caveat, which names a different
    // failure entirely.
    expect(screen.queryByText(/high-cardinality/)).not.toBeInTheDocument()
  })

  // MODEL-FLOW-019-T31. The obs/feature line had the SAME null-splitStats
  // defect as the launcher, on the same 187-of-260 runs. One resolution now
  // feeds both, so the two panels cannot disagree on one screen.
  it('reports observations per feature for a run with no splitStats, naming the source', () => {
    splitLookup.splitStats = { distinct_labelled_values: 32 }
    splitLookup.loading = false
    renderStep({
      run: {
        ...RUN,
        splitStats: null,
        datasetId: 'ds-1',
        goldArtifactId: 'art-1',
        featureImportance: {
          algorithm: 'random_forest',
          method: 'impurity',
          standardized: null,
          scaling_methods: [],
          features: [
            { name: 'tag_0', importance: 1 },
            { name: 'tag_1', importance: 0.5 },
          ],
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    // 32 distinct / 2 features = 16.0
    expect(
      screen.getByText(/16\.0 distinct labelled observations/),
    ).toBeInTheDocument()
    // An artifact-level read says so rather than passing itself off as this
    // run's own frozen record.
    expect(
      screen.getByText(/froze no split record of its own/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Observations per feature: not recorded/),
    ).not.toBeInTheDocument()
  })

  it('ranks a scaled plain-coefficient run, which the old predicate refused', () => {
    // MODEL-FLOW-019-T32's other half. Measured 2026-09-09: four of the five
    // feature specs in the dev DB are fully minmax-scaled yet reported
    // `standardized: false`, so every ols/ridge run on them read "not
    // ranked". The trainer now derives that flag from the fitted
    // `scalingParams` rather than from the always-empty `scaling` list.
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'ols',
          method: 'coefficient',
          standardized: true,
          scaling_methods: ['minmax'],
          features: [{ name: 'tag_1', importance: 0.4, coefficient: -0.4 }],
        },
      },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText('tag_1')).toBeInTheDocument()
    expect(screen.queryByText(/not ranked/)).not.toBeInTheDocument()
  })
})

// MODEL-FLOW-019-T13/V21. A non-CV run's parity scatter is drawn from the
// TEST split; a SCORED CV run's is drawn from the VALIDATION holdout —
// asserting both, on the SAME fixture shape apart from that one field, is
// what tells a working population label apart from one that names nothing.
describe('Phase5Evaluation parity scatter (MODEL-FLOW-019-T13)', () => {
  const FIT = {
    r2: METRICS.r2,
    rmse: METRICS.rmse,
    mae: METRICS.mae,
    sd: 0.435277,
    n: POINTS.length,
    points: POINTS,
  }
  const PARITY_RANGE = {
    yTrueMin: 0.1,
    yTrueMax: 0.4,
    yPredMin: 0.2,
    yPredMax: 0.5,
  }

  it("names the TEST split for a non-CV run's parity scatter", () => {
    renderStep({
      run: RUN,
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    expect(screen.getByText(/Each test split row/)).toBeInTheDocument()
    expect(
      screen.queryByText(/Each validation holdout row/),
    ).not.toBeInTheDocument()
  })

  it("names the OUT-OF-FOLD series for a CV run's parity scatter, and the VALIDATION holdout on its other tab", async () => {
    renderStep({
      run: { ...RUN, cvFoldsKey: 'cv-folds-key', predictionsKey: 'pred-key' },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
      holdout: pop('holdout', FIT, PARITY_RANGE),
    })
    expect(screen.getByText(/Each out-of-fold row/)).toBeInTheDocument()
    expect(screen.queryByText(/Each validation holdout row/)).toBeNull()

    await userEvent.click(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    )
    expect(screen.getByText(/Each validation holdout row/)).toBeInTheDocument()
    expect(screen.queryByText(/Each out-of-fold row/)).toBeNull()
  })

  // MODEL-FLOW-019-V28. A run with no recorded prediction range states
  // WHICH figure is missing — the section must not disappear silently
  // (the failure every other panel in this file already refuses: absent
  // holdout, absent importance, absent CV score each name themselves).
  it("states which figure is missing rather than rendering nothing when the parity range wasn't recorded", () => {
    renderStep({
      run: RUN,
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: null,
    })
    expect(
      screen.getByText(/prediction range wasn't recorded/),
    ).toBeInTheDocument()
  })
})

// MODEL-FLOW-019-V25, RESCOPED by MODEL-FLOW-030 (user decision 2026-10-08).
// Step 5 now has a tab switch, so the words "validation holdout" legitimately
// appear on the page — in the second tab's label. What survives is the rule
// underneath: ONE population per panel. Each tab's panel carries its own
// population's words across the sample count, all four chart panels and the
// diagnostics heading, and never another population's. The assertions are
// scoped to the ACTIVE tab panel; a page-wide "validation holdout appears
// nowhere" can no longer be true by construction.
describe('Phase5Evaluation — one population per panel (MODEL-FLOW-019-T15/V25, rescoped by MODEL-FLOW-030)', () => {
  const FIT = {
    r2: METRICS.r2,
    rmse: METRICS.rmse,
    mae: METRICS.mae,
    sd: 0.435277,
    n: POINTS.length,
    points: POINTS,
  }
  const PARITY_RANGE = {
    yTrueMin: 0.1,
    yTrueMax: 0.4,
    yPredMin: 0.2,
    yPredMax: 0.5,
  }

  it('the test-split panel names "test split" everywhere and no other population, for a non-CV run', () => {
    renderStep({
      run: RUN,
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getAllByText(/3 test split samples/).length).toBeGreaterThan(0)
    expect(panel.getAllByText(/run's test split rows/).length).toBeGreaterThan(
      0,
    )
    expect(panel.getAllByText(/Each test split row/).length).toBeGreaterThan(0)
    expect(
      panel.getAllByText(/over the run's test split rows\./).length,
    ).toBeGreaterThan(0)
    expect(
      panel.getByText('Test-split residual diagnostics'),
    ).toBeInTheDocument()
    expect(
      panel.getAllByText(/run's test split rows should be centred/).length,
    ).toBeGreaterThan(0)
    expect(panel.queryByText(/validation holdout/)).toBeNull()
    expect(panel.queryByText(/out-of-fold/)).toBeNull()
    expect(panel.queryByText('Validate residual diagnostics')).toBeNull()
  })

  it('the out-of-fold panel names "out-of-fold" everywhere and no other population, for a CV run', () => {
    renderStep({
      run: { ...RUN, cvFoldsKey: 'cv-folds-key', predictionsKey: 'pred-key' },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getAllByText(/3 out-of-fold samples/).length).toBeGreaterThan(
      0,
    )
    expect(panel.getAllByText(/run's out-of-fold rows/).length).toBeGreaterThan(
      0,
    )
    expect(panel.getAllByText(/Each out-of-fold row/).length).toBeGreaterThan(0)
    expect(
      panel.getByText('Out-of-fold (CV) residual diagnostics'),
    ).toBeInTheDocument()
    expect(panel.queryByText(/validation holdout/)).toBeNull()
    expect(panel.queryByText(/\btest split\b/)).toBeNull()
  })

  it('the holdout panel names "validation holdout" everywhere and no other population', async () => {
    renderStep({
      run: { ...RUN, cvFoldsKey: 'cv-folds-key', predictionsKey: 'pred-key' },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
      holdout: pop('holdout', FIT, PARITY_RANGE),
    })
    await userEvent.click(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    )
    const panel = within(screen.getByRole('tabpanel'))
    expect(
      panel.getAllByText(/3 validation holdout samples/).length,
    ).toBeGreaterThan(0)
    expect(
      panel.getAllByText(/run's validation holdout rows/).length,
    ).toBeGreaterThan(0)
    expect(
      panel.getAllByText(/Each validation holdout row/).length,
    ).toBeGreaterThan(0)
    expect(panel.getByText('Validate residual diagnostics')).toBeInTheDocument()
    expect(panel.queryByText(/\btest split\b/)).toBeNull()
    expect(panel.queryByText(/out-of-fold/)).toBeNull()
  })
})

// MODEL-FLOW-019-V29. The SD-band copy must state a CONSTANT width and
// must never use language a reader could mistake for a per-point
// guarantee — 'predictive interval' and 'confidence' are the two phrases
// that read that way, and their absence is asserted literally, not just
// their intended meaning.
describe('Phase5Evaluation — SD-band copy (MODEL-FLOW-019-T16/V29)', () => {
  it('states a constant width and never says "predictive interval" or "confidence"', () => {
    const { container } = renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText(/ONE constant width/)).toBeInTheDocument()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/predictive interval/i)
    expect(text).not.toMatch(/confidence/i)
  })
})

// MODEL-FLOW-030. A CV run reads like a normal one: tabs, the same tiles and
// charts, and a holdout tab whose empty states each say what is true.
describe('Phase5Evaluation — tabs for every run (MODEL-FLOW-030)', () => {
  const FIT = {
    r2: METRICS.r2,
    rmse: METRICS.rmse,
    mae: METRICS.mae,
    sd: 0.435277,
    n: POINTS.length,
    points: POINTS,
  }
  const CV_RUN = {
    ...RUN,
    cvFoldsKey: 'drafts/d/runs/r/cv_folds.json',
    predictionsKey: null,
    cvFolds: {
      algorithm: 'ols',
      n_splits: 3,
      folds: [1, 2, 3].map(n => ({
        fold: n,
        cut_timestamp: `2026-02-0${n} 00:00:00`,
        train_rows: 100 * n,
        test_rows: 50,
        distinct: 12,
        r2: 0.8,
        rmse: 1.5,
        mae: 1.1,
        train_r2: 0.9,
        train_rmse: 1,
        train_mae: 0.8,
      })),
    },
  }
  const CV_METRICS = {
    r2: 0.8123,
    rmse: 1.5,
    mae: 1.1,
    std: { r2: 0.0411, rmse: 0.25, mae: 0.1 },
    nSplits: 3,
  }

  it('offers a Test split tab and a Validation holdout tab for a normal run, on Test split first', () => {
    renderStep({ run: RUN, fit: FIT })
    expect(screen.getByRole('tab', { name: 'Test split' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    ).toHaveAttribute('aria-selected', 'false')
  })

  it('offers Out-of-fold (CV) first for a CV run', () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', FIT, null, null, CV_METRICS),
    })
    expect(
      screen.getByRole('tab', { name: 'Out-of-fold (CV)' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('shows fold mean ± std tiles and labels the SD tile as pooled', () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', FIT, null, null, CV_METRICS),
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText('0.812 ± 0.041')).toBeInTheDocument()
    expect(panel.getByText('1.500 ± 0.250')).toBeInTheDocument()
    expect(panel.getAllByText('mean ± std across 3 folds').length).toBe(3)
    expect(
      panel.getByText('pooled out-of-fold residual SD'),
    ).toBeInTheDocument()
  })

  it('draws the charts for a CV run with no holdout scoring at all', () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', FIT, null, null, CV_METRICS),
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText('Actual vs predicted over time')).toBeInTheDocument()
    expect(panel.getByText('Residuals over time')).toBeInTheDocument()
  })

  it('renders the per-fold table once, outside the tabs, before any scoring', async () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', FIT, null, null, CV_METRICS),
    })
    expect(screen.getAllByText('Per-fold configuration metrics')).toHaveLength(
      1,
    )
    expect(
      within(screen.getByRole('tabpanel')).queryByText(
        'Per-fold configuration metrics',
      ),
    ).toBeNull()
    await userEvent.click(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    )
    expect(screen.getAllByText('Per-fold configuration metrics')).toHaveLength(
      1,
    )
  })

  it('renders feature importance once, whichever tab is open', async () => {
    renderStep({
      run: {
        ...RUN,
        featureImportance: {
          algorithm: 'random_forest',
          method: 'impurity',
          standardized: null,
          scaling_methods: [],
          features: [{ name: 'tag_0', importance: 1 }],
        },
      },
      fit: FIT,
    })
    expect(screen.getAllByText('tag_0')).toHaveLength(1)
    await userEvent.click(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    )
    expect(screen.getAllByText('tag_0')).toHaveLength(1)
  })

  it('keeps the fold tiles and says so for a CV run trained before out-of-fold predictions were saved', () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', null, null, 'no-oof', CV_METRICS),
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText('0.812 ± 0.041')).toBeInTheDocument()
    expect(panel.getByText(/Retrain to see this chart/)).toBeInTheDocument()
    expect(panel.queryByText('Actual vs predicted over time')).toBeNull()
  })

  it('says an over-large series is not drawn rather than sampling it', () => {
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', null, null, 'too-large', CV_METRICS),
    })
    expect(
      within(screen.getByRole('tabpanel')).getByText(/not sampled down/),
    ).toBeInTheDocument()
  })

  describe('the holdout tab', () => {
    const openHoldout = () =>
      userEvent.click(screen.getByRole('tab', { name: 'Validation holdout' }))

    it('never scored: says so and offers Score against holdout', async () => {
      renderStep({ run: RUN, fit: FIT })
      await openHoldout()
      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getByText(/Not yet scored/)).toBeInTheDocument()
      expect(
        panel.getByRole('button', { name: /Score against holdout/ }),
      ).toBeEnabled()
    })

    it('scored figures without a series: shows the tiles and states why there is no chart', async () => {
      renderStep({
        run: RUN,
        fit: FIT,
        holdout: pop('holdout', null, null, 'no-series', {
          r2: 0.9,
          rmse: 0.77,
          mae: 0.5,
          std: null,
          nSplits: null,
        }),
      })
      await openHoldout()
      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getByText('0.770')).toBeInTheDocument()
      expect(panel.getByText(/no per-row series was kept/)).toBeInTheDocument()
      expect(panel.queryByText('Actual vs predicted over time')).toBeNull()
    })

    it('a sequence model: states there is no scoring path and offers no button', async () => {
      renderStep({ run: { ...RUN, algorithm: 'lstm' }, fit: FIT })
      await openHoldout()
      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getByText(/no windowing path for lstm/)).toBeInTheDocument()
      expect(
        panel.queryByRole('button', { name: /Score against holdout/ }),
      ).toBeNull()
    })

    it('while scoring runs: says so and disables the button', async () => {
      renderStep({
        run: { ...RUN, scoringContainerId: 'container-1' },
        fit: FIT,
      })
      await openHoldout()
      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.getByText(/Holdout scoring is running/)).toBeInTheDocument()
      expect(panel.getByRole('button', { name: /Scoring…/ })).toBeDisabled()
    })

    it('offers no Score button once the holdout series exists', async () => {
      renderStep({
        run: RUN,
        fit: FIT,
        holdout: pop('holdout', FIT),
      })
      await openHoldout()
      expect(
        screen.queryByRole('button', { name: /Score against holdout/ }),
      ).toBeNull()
    })
  })

  // Review findings on MODEL-FLOW-030.
  it('captions the out-of-fold RMSE from the POOLED residuals, not the fold mean the tile shows', () => {
    // POINTS residuals are -0.130308, -0.106366, -0.096072: their pooled RMSE
    // is ~0.1107 — nowhere near the fold-mean 1.5 the RMSE tile shows.
    renderStep({
      run: CV_RUN,
      own: pop('cv-oof', FIT, null, null, CV_METRICS),
    })
    const caption = within(screen.getByRole('tabpanel')).getByText(
      /Pooled out-of-fold RMSE/,
    )
    const pooled = Math.sqrt(
      POINTS.reduce((s, p) => s + p.residual ** 2, 0) / POINTS.length,
    )
    expect(caption.textContent).toContain(
      `Pooled out-of-fold RMSE ${pooled.toFixed(3)}`,
    )
    expect(caption.textContent).not.toContain('1.500')
  })

  it('a normal run’s caption keeps the run’s own RMSE', () => {
    renderStep({ run: RUN, fit: FIT })
    const caption = within(screen.getByRole('tabpanel')).getByText(/vs SD/)
    expect(caption.textContent).toContain(`RMSE ${METRICS.rmse.toFixed(3)}`)
    expect(caption.textContent).not.toMatch(/Pooled/)
  })

  it.each(['too-large', 'unreadable'] as const)(
    'offers no Score button on the holdout tab when the series is %s — another scoring run cannot fix that',
    async absence => {
      renderStep({
        run: RUN,
        fit: FIT,
        holdout: pop('holdout', null, null, absence, {
          r2: 0.9,
          rmse: 0.7,
          mae: 0.5,
          std: null,
          nSplits: null,
        }),
      })
      await userEvent.click(
        screen.getByRole('tab', { name: 'Validation holdout' }),
      )
      expect(
        screen.queryByRole('button', { name: /Score against holdout/ }),
      ).toBeNull()
    },
  )

  it('an over-large TEST split keeps the page: tiles, the holdout tab and Retrain survive', async () => {
    renderStep({
      run: RUN,
      own: pop('test-split', null, null, 'too-large', {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        mae: METRICS.mae,
        std: null,
        nSplits: null,
      }),
    })
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText(/not sampled down/)).toBeInTheDocument()
    expect(panel.getByText(METRICS.rmse.toFixed(3))).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Validation holdout' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /Retrain/ })).toBeVisible()
  })
})
