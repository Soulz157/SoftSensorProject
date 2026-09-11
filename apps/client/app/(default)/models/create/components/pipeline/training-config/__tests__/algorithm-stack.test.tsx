import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlgorithmStack } from '../algorithm-stack'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { ineligibleReason } from '@/lib/algorithm-eligibility'

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
