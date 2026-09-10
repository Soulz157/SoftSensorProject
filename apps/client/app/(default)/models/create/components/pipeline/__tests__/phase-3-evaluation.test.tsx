import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import { Phase5Evaluation } from '../phase-5-evaluation'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

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
    fit: null as unknown,
    manifest: null as unknown,
    parityRange: null as unknown,
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

function renderStep(overrides: Partial<typeof h.result> = {}) {
  Object.assign(h.result, {
    run: null,
    fit: null,
    manifest: null,
    parityRange: null,
    loading: false,
    error: null,
    ...overrides,
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
    expect(screen.getByText(/16\.0 distinct labelled observations/)).toBeInTheDocument()
    // An artifact-level read says so rather than passing itself off as this
    // run's own frozen record.
    expect(screen.getByText(/froze no split record of its own/)).toBeInTheDocument()
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

  it("names the VALIDATION holdout for a SCORED CV run's parity scatter", () => {
    renderStep({
      run: { ...RUN, cvFoldsKey: 'cv-folds-key', predictionsKey: 'pred-key' },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    expect(screen.getByText(/Each validation holdout row/)).toBeInTheDocument()
    expect(screen.queryByText(/Each test split row/)).not.toBeInTheDocument()
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

// MODEL-FLOW-019-V25. PROVE THE RENAME IS WHOLE: a non-CV run and a SCORED
// CV run must each carry ONE population across all four chart panels PLUS
// the banner, and the two runs must name DIFFERENT populations. Asserting
// one panel would pass against exactly the half-applied state this file
// was in before T15/T16.
describe('Phase5Evaluation — one population, every panel (MODEL-FLOW-019-T15/V25)', () => {
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

  it('names "test split" everywhere and "validation holdout" nowhere, for a non-CV run', () => {
    renderStep({
      run: RUN,
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    // Banner.
    expect(screen.getByText(/3 test split samples/)).toBeInTheDocument()
    // Actual vs Predicted.
    expect(screen.getByText(/run's test split rows/)).toBeInTheDocument()
    // Parity.
    expect(screen.getByText(/Each test split row/)).toBeInTheDocument()
    // Residuals over time.
    expect(screen.getByText(/over the run's test split\./)).toBeInTheDocument()
    // Diagnostics — heading and body.
    expect(
      screen.getByText('Test-split residual diagnostics'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/run's test split should be centred/),
    ).toBeInTheDocument()
    // The wrong word never appears.
    expect(screen.queryByText(/validation holdout/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Holdout residual diagnostics'),
    ).not.toBeInTheDocument()
  })

  it('names "validation holdout" everywhere and "test split" nowhere, for a SCORED CV run', () => {
    renderStep({
      run: { ...RUN, cvFoldsKey: 'cv-folds-key', predictionsKey: 'pred-key' },
      fit: FIT,
      manifest: { derivedFromTarget: [], targetScaled: false },
      parityRange: PARITY_RANGE,
    })
    expect(screen.getByText(/3 validation holdout samples/)).toBeInTheDocument()
    expect(
      screen.getByText(/run's validation holdout rows/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Each validation holdout row/)).toBeInTheDocument()
    expect(
      screen.getByText(/over the run's validation holdout\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Holdout residual diagnostics')).toBeInTheDocument()
    expect(
      screen.getByText(/run's validation holdout should be centred/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/\btest split\b/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Test-split residual diagnostics'),
    ).not.toBeInTheDocument()
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
