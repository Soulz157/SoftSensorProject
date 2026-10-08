import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlgorithmStack } from '../algorithm-stack'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { ineligibleReason } from '@/lib/algorithm-eligibility'
import { SIZE_TIER_LOWER_BOUNDS } from '@/lib/hyperparam-ranges'
import type { TuningGridResponse } from '@/services/tuning-grid'
import {
  TUNE_VARIANTS_PER_JOB,
  tuningVariantsFor,
} from '../../../../../../../../../backend/src/lib/tuning-grid'

// MODEL-FLOW-025. A card with Find Best Parameters on mounts the variant table,
// which fetches through this hook; without the mock every such case would try a
// real request. Default to "still loading" so cases that do not care stay inert.
vi.mock('@/hooks/model/use-tuning-grid', () => ({ useTuningGrid: vi.fn() }))
import { useTuningGrid } from '@/hooks/model/use-tuning-grid'

beforeEach(() => {
  vi.mocked(useTuningGrid).mockReset()
  vi.mocked(useTuningGrid).mockReturnValue({
    grid: null,
    loading: true,
    error: null,
  })
})

/**
 * MODEL-FLOW-019-T30. MERGED FROM TWO ORPHANED FILES, not written fresh.
 * `algorithm-selector.test.tsx` and `algorithm-param-tabs.test.tsx` both
 * imported components that do not exist: e9fcdf6 deleted `algorithm-selector
 * .tsx` and added `algorithm-stack.tsx` in its place, and the tabbed
 * hyperparameter block those tests were written against (`algorithm-param-
 * tabs.tsx`) never landed at all — `git log --all` finds no blob for it. Both
 * files failed at import resolution, collecting zero tests, so every case
 * below had stopped running without ever reporting red.
 *
 * `AlgorithmStack` is the source of truth here, not the assertions: where a
 * case described the losing design (tabs, and a "sequence" wording the stack
 * does not use), the case follows the component. Where it described real
 * behaviour the stack still carries — MODEL-FLOW-020-T06's Gaussian Process
 * size refusal and MODEL-FLOW-022-T03's self-correcting eligibility — it
 * transfers unchanged.
 */

/** The figure is the TRAIN SPLIT, not the artifact. `GPR_MAX_TRAIN_ROWS`
 * guards `n_train_rows` — the post-split, post-mask count — so these cases
 * pass `/split-stats`' `train_labelled_rows`. Testing against a raw artifact
 * row count would pass here while refusing datasets that genuinely fit. */
const OVER = 12_000
const UNDER = 6_680

type StackProps = Parameters<typeof AlgorithmStack>[0]

function stackProps(overrides: Partial<StackProps> = {}): StackProps {
  return {
    algorithms: ['ridge'] as Algorithm[],
    onAlgorithmsChange: vi.fn(),
    trainLabelledRows: null,
    perAlgorithmHyperparameters: {} as Partial<
      Record<Algorithm, Record<string, HyperparamValue>>
    >,
    hyperparameters: {} as Record<string, HyperparamValue>,
    onHyperparameterChange: vi.fn(),
    findBestParams: false,
    findBestModel: false,
    ...overrides,
  }
}

function renderStack(overrides: Partial<StackProps> = {}) {
  return render(<AlgorithmStack {...stackProps(overrides)} />)
}

/** Radix's DropdownMenu opens on pointer events it raises itself, which
 * `fireEvent.click` does not produce — the same reason
 * phase-4-model-selection.test.tsx reaches for userEvent on its own menu. */
function openAddMenu() {
  return userEvent.setup().click(screen.getByRole('button', { name: /add/i }))
}

function gpItem() {
  return screen.getByRole('menuitemcheckbox', { name: /gaussian/i })
}

/** A card's disclosure toggle, not its Remove button — both carry the
 * algorithm's label in their accessible name, so the `expanded` filter is what
 * separates them. */
function cardToggle(label: RegExp) {
  return screen.getByRole('button', { name: label, expanded: false })
}

describe('AlgorithmStack — MODEL-FLOW-020-T06 GPR size refusal', () => {
  it('disables Gaussian Process above the ceiling, naming the reason', async () => {
    renderStack({ trainLabelledRows: OVER })
    await openAddMenu()

    expect(gpItem()).toHaveAttribute('aria-disabled', 'true')
    // The ceiling itself and the dataset's own figure both appear — a
    // refusal that named neither would leave the user with no way to tell
    // how far over they are, or what would fit.
    expect(
      screen.getByText(/12,000 x 12,000 kernel matrix/),
    ).toBeInTheDocument()
    expect(screen.getByText(/10,000-row ceiling/)).toBeInTheDocument()
  })

  it('leaves Gaussian Process selectable below the ceiling', async () => {
    renderStack({ trainLabelledRows: UNDER })
    await openAddMenu()

    expect(gpItem()).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText(/kernel matrix/)).not.toBeInTheDocument()
  })

  /**
   * The null case is NOT an edge case — it is every render before Apply, and
   * every render in CV mode, where `train_labelled_rows` is null by
   * construction. Refusing on a number this component does not have would be
   * a guess wearing a limit; the trainer's own fit-time backstop still fires.
   */
  it('offers no size refusal when the train-split figure is unknown', async () => {
    renderStack({ trainLabelledRows: null })
    await openAddMenu()

    expect(gpItem()).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText(/kernel matrix/)).not.toBeInTheDocument()
  })

  it('refuses ONLY Gaussian Process — the ceiling is its own, not the dataset being too big to model', async () => {
    renderStack({ trainLabelledRows: OVER })
    await openAddMenu()

    // Random Forest is one of the three the refusal copy itself recommends;
    // asserting the refusal is scoped is what stops a future edit from
    // disabling the whole list on a large dataset.
    //
    // EXACT name, not a regex: an item's accessible name includes its own
    // reason text, so the disabled Gaussian Process entry also "contains"
    // the words Random Forest — the recommendation it makes. A loose match
    // here finds two elements and fails for a reason that has nothing to do
    // with what this case is checking.
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Random Forest' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })
})

/**
 * MODEL-FLOW-022-T03/V04. A dataset can shrink under an ALREADY-selected
 * `grp` mid-edit (the user picks a smaller dataset upstream in the same
 * session). Folding its card is not enough — the sweep would still launch a
 * candidate for it and fail at fit time — so it must leave the selection
 * too, keeping at least one algorithm.
 */
describe('AlgorithmStack — MODEL-FLOW-022 self-correcting eligibility', () => {
  it('drops grp from the selection when the dataset shrinks under it, keeping the rest', () => {
    const onAlgorithmsChange = vi.fn()
    const props = stackProps({
      algorithms: ['grp', 'ridge'] as Algorithm[],
      onAlgorithmsChange,
      trainLabelledRows: UNDER,
    })
    const { rerender } = render(<AlgorithmStack {...props} />)
    expect(onAlgorithmsChange).not.toHaveBeenCalled()

    rerender(<AlgorithmStack {...props} trainLabelledRows={OVER} />)

    expect(onAlgorithmsChange).toHaveBeenCalledWith(['ridge'])
  })

  it('never drops the LAST remaining algorithm, even if it becomes ineligible', () => {
    const onAlgorithmsChange = vi.fn()
    const props = stackProps({
      algorithms: ['grp'] as Algorithm[],
      onAlgorithmsChange,
      trainLabelledRows: UNDER,
    })
    const { rerender } = render(<AlgorithmStack {...props} />)

    rerender(<AlgorithmStack {...props} trainLabelledRows={OVER} />)

    expect(onAlgorithmsChange).not.toHaveBeenCalled()
  })

  it('ineligibleReason (the shared predicate) matches what the stack itself refuses', () => {
    expect(ineligibleReason('grp', OVER)).not.toBeNull()
    expect(ineligibleReason('grp', UNDER)).toBeNull()
    expect(ineligibleReason('ridge', OVER)).toBeNull()
  })
})

/**
 * [fix]. lstm/gru train fine as a plain single run
 * (modelDraftRunService.create, MODEL-FLOW-009-T04's windowing pipeline).
 *
 * MODEL-FLOW-024 CORRECTS what this block used to say. It claimed NEITHER
 * candidate-job kind accepts them and that the backend 400s a sequence
 * candidate outright. It does not check for one at all: what 400ed a direct
 * Find Best Parameters was the empty `TUNING_GRID` for them, which now
 * exists. So Find Best Parameters alone (HYPERPARAMETER_SEARCH, one
 * algorithm) is allowed; a SWEEP (Find Best Model) still refuses them, so a
 * user cannot select lstm, turn on Find Best Model, and only discover the
 * refusal at launch.
 */
describe('AlgorithmStack — sequence algorithms: unavailable for Find Best Model, allowed for Find Best Parameters', () => {
  function lstmItem() {
    // Anchored at the start, no \b: the label and reason spans concatenate
    // with NO space in the accessible name ("LSTMNot available..."), and
    // the reason text itself says "LSTM/GRU" — a bare /lstm/i would match
    // GRU's own item too. ^ alone already disambiguates ("GRUNot..." does
    // not start with "lstm").
    return screen.getByRole('menuitemcheckbox', { name: /^lstm/i })
  }

  it('leaves lstm selectable when neither Find Best Model nor Find Best Parameters is on', async () => {
    renderStack({ findBestModel: false, findBestParams: false })
    await openAddMenu()

    expect(lstmItem()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('disables lstm in the picker while Find Best Model is on, naming the reason', async () => {
    renderStack({ findBestModel: true })
    await openAddMenu()

    expect(lstmItem()).toHaveAttribute('aria-disabled', 'true')
    // Scoped to lstm's own item — gru's item carries the same reason text
    // (both are sequence algorithms), so an unscoped query finds two.
    expect(
      within(lstmItem()).getByText(/Not available for Find Best Model/),
    ).toBeInTheDocument()
  })

  it('leaves lstm selectable while Find Best Parameters is on without a sweep — a direct search can tune it', async () => {
    // MODEL-FLOW-024. This case used to assert the opposite.
    renderStack({ findBestModel: false, findBestParams: true })
    await openAddMenu()

    expect(lstmItem()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('does not drop lstm when only Find Best Parameters turns on', () => {
    const onAlgorithmsChange = vi.fn()
    const props = stackProps({
      algorithms: ['lstm', 'ridge'] as Algorithm[],
      onAlgorithmsChange,
      findBestParams: false,
    })
    const { rerender } = render(<AlgorithmStack {...props} />)

    rerender(<AlgorithmStack {...props} findBestParams={true} />)

    expect(onAlgorithmsChange).not.toHaveBeenCalled()
  })

  it('drops lstm from an existing selection the moment Find Best Model turns on, keeping the rest', () => {
    const onAlgorithmsChange = vi.fn()
    const props = stackProps({
      algorithms: ['lstm', 'ridge'] as Algorithm[],
      onAlgorithmsChange,
      findBestModel: false,
    })
    const { rerender } = render(<AlgorithmStack {...props} />)
    expect(onAlgorithmsChange).not.toHaveBeenCalled()

    rerender(<AlgorithmStack {...props} findBestModel={true} />)

    expect(onAlgorithmsChange).toHaveBeenCalledWith(['ridge'])
  })

  it('never drops the LAST remaining algorithm, even lstm, even under Find Best Model', () => {
    const onAlgorithmsChange = vi.fn()
    const props = stackProps({
      algorithms: ['lstm'] as Algorithm[],
      onAlgorithmsChange,
      findBestModel: false,
    })
    const { rerender } = render(<AlgorithmStack {...props} />)

    rerender(<AlgorithmStack {...props} findBestModel={true} />)

    expect(onAlgorithmsChange).not.toHaveBeenCalled()
  })

  it('refuses ONLY lstm/gru — Find Best Model does not disable every algorithm', async () => {
    renderStack({ findBestModel: true })
    await openAddMenu()

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Random Forest' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })
})

/**
 * MODEL-FLOW-022-T03/T05. Was `algorithm-param-tabs.test.tsx`. The tabs the
 * original cases reached for became one expandable card per algorithm, and
 * only one card is open at a time — so reaching a non-primary algorithm's
 * fields means clicking its disclosure toggle first, where the old file
 * clicked a tab.
 */
describe('AlgorithmStack — per-algorithm hyperparameters', () => {
  it('renders one card per selected algorithm, labelled by ALGORITHM_LABELS', () => {
    renderStack({ algorithms: ['ols', 'ridge'] as Algorithm[] })

    expect(
      screen.getByRole('button', { name: /Linear Regression/, expanded: true }),
    ).toBeInTheDocument()
    expect(cardToggle(/Ridge Regression/)).toBeInTheDocument()
  })

  it('editing a field on the SECOND (non-primary) card reports that algorithm, not the primary', async () => {
    const onHyperparameterChange = vi.fn()
    renderStack({
      algorithms: ['ols', 'ridge'] as Algorithm[],
      perAlgorithmHyperparameters: { ridge: { alpha: 1.0 } },
      onHyperparameterChange,
    })

    const user = userEvent.setup()
    await user.click(cardToggle(/Ridge Regression/))

    // A single `fireEvent.change`, not `userEvent.type` character-by-
    // character: the input is CONTROLLED off the `perAlgorithmHyperparameters`
    // prop, which this test's mock `onHyperparameterChange` never feeds
    // back into — typing digit-by-digit would race the controlled value
    // snapping back to its unchanged prop between keystrokes.
    const alphaInput = screen.getByLabelText(/alpha/i)
    fireEvent.change(alphaInput, { target: { value: '0.037' } })

    expect(onHyperparameterChange).toHaveBeenCalledWith('ridge', 'alpha', 0.037)
  })

  it("each card reads its OWN entry, not the primary's or another card's", async () => {
    renderStack({
      algorithms: ['ridge', 'xgboost'] as Algorithm[],
      perAlgorithmHyperparameters: {
        ridge: { alpha: 0.037 },
        xgboost: { n_estimators: 250 },
      },
    })

    expect(screen.getByLabelText(/alpha/i)).toHaveValue(0.037)

    const user = userEvent.setup()
    await user.click(cardToggle(/XGBoost/))
    expect(screen.getByLabelText(/n_estimators|estimators/i)).toHaveValue(250)
  })

  /**
   * MODEL-FLOW-019-T30, new here: neither orphan covered `paramsFor`'s
   * index-0 fallback, and MODEL-FLOW-022-V01 is only partially_verified.
   * The flat `hyperparameters` dict answers for the PRIMARY only — a
   * non-primary card falling back to it would silently show the user one
   * algorithm's values under another algorithm's name.
   */
  it('falls back to the flat hyperparameters dict for the primary ONLY, never a later card', async () => {
    renderStack({
      algorithms: ['ridge', 'xgboost'] as Algorithm[],
      perAlgorithmHyperparameters: {},
      hyperparameters: { alpha: 0.5 },
    })

    expect(screen.getByLabelText(/alpha/i)).toHaveValue(0.5)

    const user = userEvent.setup()
    await user.click(cardToggle(/XGBoost/))
    // 100 is XGBoost's own catalog default, not anything the flat dict holds.
    expect(screen.getByLabelText(/n_estimators|estimators/i)).toHaveValue(100)
  })

  it('states the sequential-run cost, including the fit count', () => {
    renderStack({ algorithms: ['ols', 'ridge', 'xgboost'] as Algorithm[] })

    // "Expect", the count and " fits" are separate text nodes, so a plain
    // `getByText(/3 fits/)` matches none of them — assert on the paragraph's
    // combined textContent instead, the same way core-config.test.tsx does
    // for its own multi-node sentence.
    expect(
      screen.getByText((_content, element) =>
        Boolean(
          element?.tagName === 'P' &&
          /one at a time/i.test(element.textContent ?? '') &&
          /3 fits/i.test(element.textContent ?? ''),
        ),
      ),
    ).toBeInTheDocument()
  })
})

/**
 * MODEL-FLOW-024. The size reaches the hint under each field. The tier keys on
 * ROWS (the user's decision, 2026-09-21): the real measured pair (8,350 rows,
 * 32 distinct values) is a `small` dataset, and the copy names the rows, never
 * the distinct count.
 */
describe('AlgorithmStack — suggested ranges follow the dataset size (MODEL-FLOW-024)', () => {
  it('shows the estimator’s general range, and says it is not sized, before a size is known', () => {
    renderStack({ algorithms: ['xgboost'] as Algorithm[] })

    expect(screen.getByText('100–500')).toBeInTheDocument()
    expect(screen.getByText(/apply the train\/test split/i)).toBeInTheDocument()
    expect(screen.queryByText(/Sized to your/)).not.toBeInTheDocument()
  })

  it('narrows XGBoost’s n_estimators band for the measured 8,350-row dataset, and names its rows', () => {
    renderStack({
      algorithms: ['xgboost'] as Algorithm[],
      datasetSize: { distinctLabelled: 32, rows: 8_350 },
    })

    expect(screen.getByText('50–300')).toBeInTheDocument()
    expect(screen.queryByText('100–500')).not.toBeInTheDocument()
    expect(screen.getByText(/Sized to your 8,350 rows/)).toBeInTheDocument()
    expect(
      screen.getByText(/4,380-8,759 rows, 6-12 months of hourly data/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/distinct/)).not.toBeInTheDocument()
  })

  it('narrows the band further for a tiny dataset', () => {
    renderStack({
      algorithms: ['xgboost'] as Algorithm[],
      datasetSize: { rows: 2_000 },
    })

    expect(screen.getByText('30–150')).toBeInTheDocument()
  })

  it('widens the band for a large dataset', () => {
    renderStack({
      algorithms: ['xgboost'] as Algorithm[],
      datasetSize: { rows: 30_000 },
    })

    expect(screen.getByText('200–1000')).toBeInTheDocument()
  })

  it('caps the LSTM batch size by rows and leaves its other bands alone', () => {
    renderStack({
      algorithms: ['lstm'] as Algorithm[],
      datasetSize: { distinctLabelled: null, rows: 400 },
    })

    expect(screen.getByText('12–50')).toBeInTheDocument()
    expect(screen.getByText('10–200')).toBeInTheDocument() // epochs, unsized
    expect(
      screen.getByText(/capped at an eighth of your 400 rows/),
    ).toBeInTheDocument()
  })

  it('never claims sizing for an algorithm no size changes', () => {
    renderStack({
      algorithms: ['pls'] as Algorithm[],
      datasetSize: { distinctLabelled: 32, rows: 8_350 },
    })

    expect(screen.queryByText(/Sized to your/)).not.toBeInTheDocument()
    expect(screen.getByText(/no size-dependent range/)).toBeInTheDocument()
  })
})

/**
 * MODEL-FLOW-025. Each open card shows the variants Find Best Parameters will
 * try for it. The list is the endpoint's grid minus what the LAUNCH's base
 * covers, so these cases check the wiring: when it appears, what it is labelled,
 * which cards fetch, and that the base is the job's and not the card's own.
 */
describe('AlgorithmStack — Find Best Parameters variant preview (MODEL-FLOW-025)', () => {
  function serveGrid(algorithm: Algorithm, size?: { rows: number }) {
    const grid: TuningGridResponse = {
      algorithm,
      variants: tuningVariantsFor(algorithm, size),
      maxVariantsPerJob: TUNE_VARIANTS_PER_JOB,
      tier: 'medium',
      sized: false,
    }
    vi.mocked(useTuningGrid).mockReturnValue({
      grid,
      loading: false,
      error: null,
    })
  }

  const fetchedAlgorithms = () =>
    vi.mocked(useTuningGrid).mock.calls.map(([algorithm]) => algorithm)

  it('shows no variant table, and fetches nothing, while Find Best Parameters is off', () => {
    renderStack({
      algorithms: ['ridge', 'svm'] as Algorithm[],
      findBestModel: true,
      findBestParams: false,
    })

    expect(screen.queryByText(/Hyperparameter Tuning/)).not.toBeInTheDocument()
    expect(useTuningGrid).not.toHaveBeenCalled()
  })

  it('direct search (one algorithm, Find Best Parameters only): a table titled "Hyperparameter Tuning"', () => {
    serveGrid('ridge')
    renderStack({
      algorithms: ['ridge'] as Algorithm[],
      findBestModel: false,
      findBestParams: true,
    })

    expect(screen.getByText('Hyperparameter Tuning')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('sweep then tune: titled "if this wins", and only the OPEN card fetches', () => {
    serveGrid('ridge')
    renderStack({
      algorithms: ['ridge', 'svm'] as Algorithm[],
      findBestModel: true,
      findBestParams: true,
    })

    expect(screen.getByText('Hyperparameter Tuning')).toBeInTheDocument()
    // Ridge is primary and therefore open; SVM's card is folded, so it must not
    // be asking the server for a grid nobody can see.
    expect(new Set(fetchedAlgorithms())).toEqual(new Set(['ridge']))
  })

  it('moves the table, and the fetch, to whichever card is opened', async () => {
    serveGrid('svm')
    renderStack({
      algorithms: ['ridge', 'svm'] as Algorithm[],
      findBestModel: true,
      findBestParams: true,
    })

    await userEvent.setup().click(cardToggle(/support vector|svm/i))

    expect(fetchedAlgorithms()).toContain('svm')
    expect(screen.getAllByText('Hyperparameter Tuning')).toHaveLength(1)
  })

  it('hands the hook the dataset size the form already sized its ranges with', () => {
    serveGrid('ridge')
    const datasetSize = { rows: 6_000 }
    renderStack({
      algorithms: ['ridge'] as Algorithm[],
      findBestParams: true,
      datasetSize,
    })

    expect(useTuningGrid).toHaveBeenCalledWith('ridge', datasetSize)
  })

  it('excludes against the base the LAUNCH sends, not the card’s display record', async () => {
    // At the large tier SVM's default record IS one of its four variants. With
    // no entry the card's own record is {} (the wizard's draft pre-fills
    // defaults, but nothing at this boundary guarantees it), while the job
    // sends the full defaults — so the search would run three, and the table
    // must say three.
    const rows = SIZE_TIER_LOWER_BOUNDS.large * 2
    serveGrid('svm', { rows })
    renderStack({
      algorithms: ['ridge', 'svm'] as Algorithm[],
      findBestModel: true,
      findBestParams: true,
      datasetSize: { rows },
    })

    await userEvent.setup().click(cardToggle(/support vector|svm/i))

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(
      TUNE_VARIANTS_PER_JOB - 1,
    )
    expect(screen.getByText(/1 variant skipped/i)).toBeInTheDocument()
  })

  it('points the stack’s summary line at the per-card tables instead of leaving the variants unnamed', () => {
    renderStack({
      algorithms: ['ridge', 'svm'] as Algorithm[],
      findBestModel: true,
      findBestParams: true,
    })

    expect(
      screen.getByText(/open an algorithm to see them/i),
    ).toBeInTheDocument()
  })
})
