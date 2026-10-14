import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoMlToggles } from '../automl-toggles'
import type { Algorithm } from '@/store/model-pipeline'

/**
 * Find Best Model was removed 2026-10-14: training every selected algorithm
 * is the default and Step 4 recommends the best. Find Best Parameters is the
 * one toggle left, available for any selection, and its description says
 * what it will tune for the current one.
 */
function baseProps() {
  return {
    findBestParams: false,
    onFindBestParams: vi.fn(),
    cvEnabled: false,
    algorithms: ['ridge'] as Algorithm[],
  }
}

function findBestParamsSwitch() {
  return screen.getByRole('switch', { name: /find best parameters/i })
}

describe('AutoMlToggles', () => {
  it('has no Find Best Model toggle any more', () => {
    render(<AutoMlToggles {...baseProps()} />)
    expect(
      screen.queryByRole('switch', { name: /find best model/i }),
    ).not.toBeInTheDocument()
  })

  it('with one algorithm, searches that algorithm', () => {
    render(<AutoMlToggles {...baseProps()} algorithms={['ridge']} />)
    expect(findBestParamsSwitch()).not.toBeDisabled()
    expect(
      screen.getByText(
        /curated set of hyperparameter variants for this algorithm/i,
      ),
    ).toBeInTheDocument()
  })

  it('with two or more algorithms, tunes the one with the lowest Test RMSE', () => {
    render(<AutoMlToggles {...baseProps()} algorithms={['ridge', 'ols']} />)
    expect(findBestParamsSwitch()).not.toBeDisabled()
    expect(
      screen.getByText(/tune the one with the lowest Test RMSE/i),
    ).toBeInTheDocument()
  })

  it('reports a click to the caller', async () => {
    const props = baseProps()
    render(<AutoMlToggles {...props} />)
    await userEvent.click(findBestParamsSwitch())
    expect(props.onFindBestParams).toHaveBeenCalledWith(true)
  })
})

describe('AutoMlToggles — with Cross-Validation on (MODEL-FLOW-029)', () => {
  it('keeps Find Best Parameters enabled for one algorithm and says each variant is cross-validated', () => {
    render(<AutoMlToggles {...baseProps()} cvEnabled algorithms={['ridge']} />)
    expect(findBestParamsSwitch()).not.toBeDisabled()
    expect(
      screen.getByText(/every variant is cross-validated/i),
    ).toBeInTheDocument()
  })
})
