import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import {
  mpFineTuneEnabledAtom,
  mpFineTuneUseGridAtom,
  mpLossFunctionAtom,
  mpServerDraftIdAtom,
} from '@/store/model-pipeline'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { useFineTune } from '@/hooks/model/use-fine-tune'
import { FineTuneSection } from '../fine-tune-section'

/**
 * MODEL-FLOW-035 — Round 2 as a panel inside Algorithm & hyperparameters,
 * driven by `useFineTune` (the same hook Step 3's single Start button reads).
 * The network hooks are mocked; the store is real, so the switches, the
 * picker and the Loss function behave as they do in the wizard.
 */
const h = vi.hoisted(() => ({
  runs: [] as ModelTrainingRunListItem[],
}))

vi.mock('@/hooks/model/use-draft-runs', () => ({
  useDraftRuns: () => ({
    runs: h.runs,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))
vi.mock('@/hooks/model/use-tuning-grid', () => ({
  useTuningGrid: () => ({ grid: null, loading: true, error: null }),
}))
vi.mock('@/hooks/model/use-tuning-variant-counts', () => ({
  useTuningVariantCounts: () => ({}),
}))

function run(over: Record<string, unknown>): ModelTrainingRunListItem {
  return {
    id: 'r',
    algorithm: 'ridge',
    status: 'SUCCEEDED',
    createdAt: '2026-01-01T00:00:00Z',
    targetY: 'TI-101',
    hyperparameters: { alpha: 3 },
    metrics: { r2: 0.9, rmse: 2, mae: 1 },
    holdoutMetrics: null,
    cvFoldsKey: null,
    predictionsKey: null,
    scoringContainerId: null,
    splitSpec: { method: 'time_ordered', ratio: 0.8 },
    ...over,
  } as unknown as ModelTrainingRunListItem
}

const NAV = {
  targetVariables: ['TI-101'],
  trainTestSplit: 80,
  nSplits: undefined,
} as unknown as UsePipelineNavResult
const SIZE = { rows: 1000, distinctLabelled: 50 }

const launched = vi.fn()

/** The panel plus a stand-in for Step 3's Start button, both on one hook. */
function Harness({ training }: { training: boolean }) {
  const fineTune = useFineTune({ nav: NAV, training, datasetSize: SIZE })
  return (
    <>
      <FineTuneSection
        fineTune={fineTune}
        nSplits={undefined}
        datasetSize={SIZE}
      />
      <p data-testid="refusal">{fineTune.refusal ?? ''}</p>
      <p data-testid="active">{String(fineTune.active)}</p>
      <button
        type="button"
        disabled={!fineTune.active || fineTune.refusal !== null}
        onClick={() => launched(fineTune.input)}
      >
        Start
      </button>
    </>
  )
}

function renderSection(
  configure?: (store: ReturnType<typeof createStore>) => void,
  training = false,
) {
  const store = createStore()
  store.set(mpServerDraftIdAtom, 'draft-1')
  configure?.(store)
  render(
    <Provider store={store}>
      <Harness training={training} />
    </Provider>,
  )
  return store
}

const on = (s: ReturnType<typeof createStore>) =>
  s.set(mpFineTuneEnabledAtom, true)
const refusal = () => screen.getByTestId('refusal').textContent
const fineTuneSwitch = () => screen.getByRole('switch', { name: 'Fine-tune' })

describe('FineTuneSection + useFineTune (MODEL-FLOW-035)', () => {
  beforeEach(() => {
    launched.mockReset()
    h.runs = [
      run({ id: 'a', algorithm: 'ridge', metrics: { rmse: 3, mae: 1 } }),
      run({
        id: 'b',
        algorithm: 'ols',
        hyperparameters: { fit_intercept: true },
        metrics: { rmse: 2, mae: 2 },
      }),
    ]
  })

  it('is unavailable, switch disabled, before any run has succeeded', () => {
    h.runs = [run({ id: 'f', status: 'FAILED', metrics: null })]
    renderSection(on)
    expect(fineTuneSwitch()).toBeDisabled()
    expect(
      screen.getByText(/Available once a training run succeeds/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('active')).toHaveTextContent('false')
  })

  it('is off by default: Start trains every algorithm, no picker shown', () => {
    renderSection()
    expect(fineTuneSwitch()).not.toBeChecked()
    expect(
      screen.getByText(/trains every algorithm above once/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Model to fine-tune')).not.toBeInTheDocument()
    expect(screen.getByTestId('active')).toHaveTextContent('false')
  })

  it('turning it on makes Start fine-tune, opening on the best run by the Loss function', () => {
    renderSection()
    fireEvent.click(fineTuneSwitch())
    expect(screen.getByTestId('active')).toHaveTextContent('true')
    // One card per trained algorithm, as in Round 1; the best is checked.
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(
      screen.getByRole('radio', { name: /Linear Regression/ }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('opens on a different run when the Loss function is MAE', () => {
    renderSection(s => {
      on(s)
      s.set(mpLossFunctionAtom, 'mae')
    })
    expect(
      screen.getByRole('radio', { name: /Ridge Regression/ }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('picking another card tunes that algorithm', () => {
    renderSection(on)
    fireEvent.click(screen.getByRole('radio', { name: /Ridge Regression/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(launched).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm: 'ridge' }),
    )
  })

  it("the open card's fields start at the run's values and edits change the fine-tune's base", () => {
    h.runs = [run({ id: 'a' })]
    renderSection(on)
    const alpha = screen.getByLabelText(/Alpha/)
    expect(alpha).toHaveValue(3)
    fireEvent.change(alpha, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(launched).toHaveBeenCalledWith(
      expect.objectContaining({
        algorithm: 'ridge',
        base: expect.objectContaining({ alpha: 7 }),
      }),
    )
  })

  it('Start sends a one-algorithm fine-tune from the chosen run, Find Best Parameters on', () => {
    h.runs = [run({ id: 'a' })]
    renderSection(on)
    expect(
      screen.getByRole('switch', { name: 'Find Best Parameters' }),
    ).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(launched).toHaveBeenCalledWith({
      algorithm: 'ridge',
      // The run's own value, over the algorithm's full defaults.
      base: expect.objectContaining({ alpha: 3, fit_intercept: true }),
      rows: [],
      useGrid: true,
    })
  })

  it('refuses while a run is training', () => {
    h.runs = [run({ id: 'a' })]
    renderSection(on, true)
    expect(refusal()).toMatch(/in progress/)
  })

  it('refuses a run for another target', () => {
    h.runs = [run({ id: 'a', targetY: 'TI-999' })]
    renderSection(on)
    expect(refusal()).toMatch(/predicts TI-999/)
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('with Find Best Parameters off and no added row, asks for a variant', () => {
    h.runs = [run({ id: 'a' })]
    renderSection(s => {
      on(s)
      s.set(mpFineTuneUseGridAtom, false)
    })
    expect(refusal()).toMatch(/Add a variant.*turn on Find Best Parameters/)
  })
})
