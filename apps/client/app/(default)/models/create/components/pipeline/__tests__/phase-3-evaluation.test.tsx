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
})
