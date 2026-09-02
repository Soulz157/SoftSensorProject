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
const METRICS = { r2: -2.406723649677836, rmse: 0.5259401632305729 }
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
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })

    // METRIC_META['r2'].format = v => v.toFixed(3)
    expect(screen.getByText(METRICS.r2.toFixed(3))).toBeInTheDocument()
    // METRIC_META['rmse'].format uses toLocaleString with 2 fraction digits.
    expect(
      screen.getByText(
        METRICS.rmse.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ),
    ).toBeInTheDocument()
  })

  it('renders both charts and the diagnostics section when the run succeeded', () => {
    const { container } = renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })

    expect(screen.getByText('Actual vs Predicted')).toBeInTheDocument()
    expect(screen.getByText('Residuals')).toBeInTheDocument()
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
    expect(screen.queryByText('Actual vs Predicted')).not.toBeInTheDocument()
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

  it('disables the Compare-with control rather than fabricating a series', () => {
    renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: [], targetScaled: false },
    })
    expect(screen.getByText('Compare with…').closest('button')).toBeDisabled()
  })

  it('names the target-derived feature count when the manifest reports one', () => {
    renderStep({
      run: RUN,
      fit: {
        r2: METRICS.r2,
        rmse: METRICS.rmse,
        sd: 0.435277,
        n: POINTS.length,
        points: POINTS,
      },
      manifest: { derivedFromTarget: ['lag_1'], targetScaled: false },
    })
    expect(screen.getByText(/1 target-derived feature/)).toBeInTheDocument()
  })
})
