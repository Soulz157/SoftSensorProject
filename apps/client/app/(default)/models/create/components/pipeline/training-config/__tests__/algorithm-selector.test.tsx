import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlgorithmSelector } from '../algorithm-selector'
import type { Algorithm } from '@/store/model-pipeline'

/**
 * MODEL-FLOW-020-T06. Gaussian Process is refused AT SELECTION when the
 * dataset is over the ceiling `build_model` measures it against, rather than
 * after a container spawn, an artifact download and a queue slot have already
 * been spent reaching the same refusal.
 *
 * No test file for this component existed before this task.
 *
 * THE FIGURE IS THE TRAIN SPLIT, NOT THE ARTIFACT. `GPR_MAX_TRAIN_ROWS`
 * guards `n_train_rows` — the post-split, post-mask count — so these cases
 * pass `/split-stats`' `train_labelled_rows`. Testing against a raw artifact
 * row count would pass here while refusing datasets that genuinely fit.
 */
const OVER = 12_000
const UNDER = 6_680

function open() {
  // Radix's DropdownMenu opens on pointer events it raises itself, which
  // `fireEvent.click` does not produce — the same reason
  // phase-4-model-selection.test.tsx reaches for userEvent on its own menu.
  return userEvent.setup().click(screen.getByRole('button', { name: /add/i }))
}

function renderSelector(trainLabelledRows: number | null) {
  return render(
    <AlgorithmSelector
      algorithms={['ridge'] as Algorithm[]}
      onChange={vi.fn()}
      trainLabelledRows={trainLabelledRows}
    />,
  )
}

function gpItem() {
  return screen.getByRole('menuitemcheckbox', { name: /gaussian/i })
}

describe('AlgorithmSelector — MODEL-FLOW-020-T06 GPR size refusal', () => {
  it('disables Gaussian Process above the ceiling, naming the reason', async () => {
    renderSelector(OVER)
    await open()

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
    renderSelector(UNDER)
    await open()

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
    renderSelector(null)
    await open()

    expect(gpItem()).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText(/kernel matrix/)).not.toBeInTheDocument()
  })

  it('refuses ONLY Gaussian Process — the ceiling is its own, not the dataset being too big to model', async () => {
    renderSelector(OVER)
    await open()

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
