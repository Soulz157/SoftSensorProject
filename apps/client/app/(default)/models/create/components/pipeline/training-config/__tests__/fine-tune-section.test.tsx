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
 * MODEL-FLOW-035 — Round 2, Step 3's last section since MODEL-FLOW-036,
 * driven by `useFineTune` (the same hook Step 3's one Start button reads).
 * The network hooks are mocked; the store is real, so the switches, the
 * picker and the Loss function behave as they do in the wizard.
 */
const h = vi.hoisted(() => ({
  runs: [] as ModelTrainingRunListItem[],
  /** MODEL-FLOW-038. What `GET /training/param-grid/:algorithm` serves. */
  grids: {
    ridge: { alpha: [0.01, 0.1, 1, 10, 100], fit_intercept: [true, false] },
    ols: { fit_intercept: [true, false] },
    extra_trees: { n_estimators: [100, 300], max_depth: [10, 20] },
  } as Record<string, Record<string, (number | boolean | string)[]>>,
  gridFetches: [] as (string | null)[],
  /** What the endpoint reports as the trainer's CPU budget. */
  cpuBudget: 2,
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
vi.mock('@/hooks/model/use-param-grid', () => ({
  useParamGrid: (algorithm: string | null) => {
    h.gridFetches.push(algorithm)
    const paramGrid = algorithm ? h.grids[algorithm] : undefined
    return {
      grid: paramGrid
        ? {
            algorithm,
            paramGrid,
            tier: 'medium',
            maxCombinations: 64,
            maxValuesPerKey: 10,
            cpuBudget: h.cpuBudget,
            parallel:
              algorithm === 'extra_trees' || algorithm === 'random_forest',
          }
        : null,
      loading: false,
      error: null,
    }
  },
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
      <p data-testid="workers">{String(fineTune.searchWorkers)}</p>
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
// The open card's own field. The grid editor's box for the same key reads
// "… — values to search", so a bare /Alpha/ would match both.
const CARD_ALPHA = /^Alpha \(regularization\)$/
const GRID_ALPHA = /^Alpha \(regularization\) — values to search$/
const fineTuneSwitch = () => screen.getByRole('switch', { name: 'Fine-tune' })

describe('FineTuneSection + useFineTune (MODEL-FLOW-035)', () => {
  beforeEach(() => {
    launched.mockReset()
    h.gridFetches = []
    h.cpuBudget = 2
    h.grids = {
      ridge: { alpha: [0.01, 0.1, 1, 10, 100], fit_intercept: [true, false] },
      ols: { fit_intercept: [true, false] },
      extra_trees: { n_estimators: [100, 300], max_depth: [10, 20] },
    }
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

  it('is off by default: no picker shown, inactive', () => {
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
    const alpha = screen.getByLabelText(CARD_ALPHA)
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

  it('the picked card folds and unfolds on its chevron, like an algorithm card (MODEL-FLOW-036-T08)', () => {
    renderSection(on)
    fireEvent.click(screen.getByRole('radio', { name: /Ridge Regression/ }))
    expect(screen.getByLabelText(CARD_ALPHA)).toBeInTheDocument()

    const hide = screen.getByRole('button', {
      name: 'Hide Ridge Regression hyperparameters',
    })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(hide)
    expect(screen.queryByLabelText(CARD_ALPHA)).not.toBeInTheDocument()
    // Folding changes nothing about which run is tuned.
    expect(
      screen.getByRole('radio', { name: /Ridge Regression/ }),
    ).toHaveAttribute('aria-checked', 'true')

    const show = screen.getByRole('button', {
      name: 'Show Ridge Regression hyperparameters',
    })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(show)
    expect(screen.getByLabelText(CARD_ALPHA)).toBeInTheDocument()
  })

  it('only the picked card has a chevron, and picking a card opens it even after a fold', () => {
    renderSection(on)
    fireEvent.click(screen.getByRole('radio', { name: /Ridge Regression/ }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Hide Ridge Regression hyperparameters',
      }),
    )
    expect(
      screen.queryByRole('button', {
        name: /Linear Regression hyperparameters/,
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Linear Regression/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Ridge Regression/ }))
    expect(screen.getByLabelText(CARD_ALPHA)).toBeInTheDocument()
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
      // MODEL-FLOW-038. The server's lists, the run's own alpha merged in.
      paramGrid: {
        alpha: [0.01, 0.1, 1, 3, 10, 100],
        fit_intercept: [true, false],
      },
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

  describe('grid search editor (MODEL-FLOW-038)', () => {
    const cost = () => screen.getByTestId('grid-cost').textContent

    it('shows one plain text box per searched key, never a number input', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      const alpha = screen.getByLabelText(GRID_ALPHA)
      expect(alpha).toHaveAttribute('type', 'text')
      expect(alpha).toHaveValue('0.01, 0.1, 1, 10, 100')
      const group = screen.getByRole('group', { name: /grid search/i })
      expect(group.querySelectorAll('input[type="number"]')).toHaveLength(0)
      expect(group.querySelectorAll('input[type="text"]')).toHaveLength(2)
    })

    it('counts combinations × folds, with the run’s own value always included', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      // alpha 3 joins the five defaults: 6 x 2 fit_intercept = 12.
      expect(cost()).toMatch(/12 combinations × 1 fold = 12 fits/)
    })

    it('typing a list updates the count live', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      fireEvent.change(screen.getByLabelText(GRID_ALPHA), {
        target: { value: '0.1, 1' },
      })
      // 0.1, 1 and the run's 3 -> 3 x 2.
      expect(cost()).toMatch(/6 combinations/)
      expect(
        screen.getByText(/your current 3 is always included/),
      ).toBeVisible()
    })

    it('names a bad token, flags the box, and blocks Start', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      const alpha = screen.getByLabelText(GRID_ALPHA)
      fireEvent.change(alpha, { target: { value: '0.1, abc' } })
      expect(alpha).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText(/"abc" is not a number/)).toBeInTheDocument()
      expect(refusal()).toMatch(/Fix the values for alpha/)
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    })

    it('an emptied box blocks Start rather than quietly using the default', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      fireEvent.change(screen.getByLabelText(GRID_ALPHA), {
        target: { value: '' },
      })
      expect(screen.getByText('Enter at least one value')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    })

    it('refuses a grid over the server’s combination cap, and says how many', () => {
      h.runs = [run({ id: 'a' })]
      h.grids.ridge = {
        alpha: [1, 2, 3],
        fit_intercept: [true, false],
        solver: ['auto', 'svd', 'cholesky', 'lsqr'],
      }
      renderSection(on)
      // 3 x 2 x 4 = 24 as served: fine.
      expect(refusal()).toBe('')
      fireEvent.change(screen.getByLabelText(GRID_ALPHA), {
        target: { value: '1,2,3,4,5,6,7,8,9' },
      })
      // 9 x 2 x 4 = 72, over the server's 64.
      expect(refusal()).toMatch(/72 combinations.*64/)
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    })

    it('sends the typed grid on Start, with no extra rows', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      fireEvent.change(screen.getByLabelText(GRID_ALPHA), {
        target: { value: '0.5, 5' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
      expect(launched).toHaveBeenCalledWith(
        expect.objectContaining({
          paramGrid: { alpha: [0.5, 3, 5], fit_intercept: [true, false] },
        }),
      )
    })

    it('Reset drops the typed text back to the server’s lists', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(on)
      const alpha = screen.getByLabelText(GRID_ALPHA)
      fireEvent.change(alpha, { target: { value: '9' } })
      fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
      expect(screen.getByLabelText(GRID_ALPHA)).toHaveValue(
        '0.01, 0.1, 1, 10, 100',
      )
    })

    describe('search workers for the runtime estimate', () => {
      const workers = () => screen.getByTestId('workers').textContent
      const forest = () => {
        h.runs = [
          run({
            id: 'e',
            algorithm: 'extra_trees',
            hyperparameters: { n_estimators: 100, max_depth: 10 },
          }),
        ]
      }

      it('is the CPU budget for a forest search with enough fits', () => {
        forest()
        renderSection(on)
        // 2 x 2 grid = 4 fits; budget 2.
        expect(workers()).toBe('2')
      })

      it('follows a larger budget the server reports, up to the number of fits', () => {
        forest()
        h.cpuBudget = 8
        renderSection(on)
        expect(workers()).toBe('4') // 4 fits cap it
      })

      it('is one for an algorithm the trainer searches serially', () => {
        h.runs = [run({ id: 'a' })]
        renderSection(on)
        expect(workers()).toBe('1')
      })

      it('is one on a single-CPU budget', () => {
        forest()
        h.cpuBudget = 1
        renderSection(on)
        expect(workers()).toBe('1')
      })

      it('is undefined while the grid cannot launch, so nothing is priced from a half-typed list', () => {
        forest()
        renderSection(on)
        fireEvent.change(
          screen.getByLabelText(/N-estimators — values to search/),
          {
            target: { value: 'oops' },
          },
        )
        expect(workers()).toBe('undefined')
      })
    })

    it('fetches no grid, and shows no editor, with Find Best Parameters off', () => {
      h.runs = [run({ id: 'a' })]
      renderSection(s => {
        on(s)
        s.set(mpFineTuneUseGridAtom, false)
      })
      expect(screen.queryByRole('group', { name: /grid search/i })).toBeNull()
      expect(h.gridFetches.every(a => a === null)).toBe(true)
    })

    it('lstm keeps the curated variant table: no grid fetched, no editor', () => {
      h.runs = [
        run({
          id: 'l',
          algorithm: 'lstm',
          hyperparameters: { epochs: 30, hidden_size: 32, batch_size: 64 },
        }),
      ]
      renderSection(on)
      expect(screen.queryByRole('group', { name: /grid search/i })).toBeNull()
      expect(h.gridFetches.every(a => a === null)).toBe(true)
    })
  })
})
