import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlgorithmParamTabs } from '../algorithm-param-tabs'
import type { Algorithm } from '@/store/model-pipeline'

/**
 * MODEL-FLOW-022-T03/T05. First use of `@/components/ui/tabs` in the model
 * create wizard — no existing test file to extend.
 */
describe('AlgorithmParamTabs', () => {
  it('renders one tab per selected algorithm, labelled by ALGORITHM_LABELS', () => {
    render(
      <AlgorithmParamTabs
        algorithms={['ols', 'ridge'] as Algorithm[]}
        perAlgorithmHyperparameters={{}}
        onHyperparameterChange={vi.fn()}
        findBestParams={false}
      />,
    )

    expect(
      screen.getByRole('tab', { name: 'Linear Regression' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Ridge Regression' }),
    ).toBeInTheDocument()
  })

  it('editing a field on the SECOND (non-primary) tab reports that algorithm, not the primary', async () => {
    const onHyperparameterChange = vi.fn()
    render(
      <AlgorithmParamTabs
        algorithms={['ols', 'ridge'] as Algorithm[]}
        perAlgorithmHyperparameters={{ ridge: { alpha: 1.0 } }}
        onHyperparameterChange={onHyperparameterChange}
        findBestParams={false}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Ridge Regression' }))

    // A single `fireEvent.change`, not `userEvent.type` character-by-
    // character: the input is CONTROLLED off the `perAlgorithmHyperparameters`
    // prop, which this test's mock `onHyperparameterChange` never feeds
    // back into — typing digit-by-digit would race the controlled value
    // snapping back to its unchanged prop between keystrokes.
    const alphaInput = screen.getByLabelText(/alpha/i)
    fireEvent.change(alphaInput, { target: { value: '0.037' } })

    expect(onHyperparameterChange).toHaveBeenCalledWith('ridge', 'alpha', 0.037)
  })

  it("each tab reads its OWN entry, not the primary's or another tab's", async () => {
    render(
      <AlgorithmParamTabs
        algorithms={['ridge', 'xgboost'] as Algorithm[]}
        perAlgorithmHyperparameters={{
          ridge: { alpha: 0.037 },
          xgboost: { n_estimators: 250 },
        }}
        onHyperparameterChange={vi.fn()}
        findBestParams={false}
      />,
    )

    expect(screen.getByLabelText(/alpha/i)).toHaveValue(0.037)

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'XGBoost' }))
    expect(screen.getByLabelText(/n_estimators|estimators/i)).toHaveValue(250)
  })

  it('states the sequential-run cost, including the fit count', () => {
    render(
      <AlgorithmParamTabs
        algorithms={['ols', 'ridge', 'xgboost'] as Algorithm[]}
        perAlgorithmHyperparameters={{}}
        onHyperparameterChange={vi.fn()}
        findBestParams={false}
      />,
    )

    expect(screen.getByText(/sequence/i)).toBeInTheDocument()
    expect(screen.getByText(/3 fits/i)).toBeInTheDocument()
  })
})
