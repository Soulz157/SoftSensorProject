import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AutoMlToggles } from '../automl-toggles'
import type { Algorithm } from '@/store/model-pipeline'

/**
 * [fix]. "allow find best parameter when select 1 algorithm" — Find Best
 * Parameters is enabled either via Find Best Model's sweep (unchanged) OR
 * directly when exactly one algorithm is selected, with no sweep on. These
 * cases were previously untested — no test file for this component existed
 * before this fix.
 */
function baseProps() {
  return {
    findBestModel: false,
    onFindBestModel: vi.fn(),
    findBestParams: false,
    onFindBestParams: vi.fn(),
    cvEnabled: false,
    algorithms: ['ridge'] as Algorithm[],
  }
}

function findBestParamsSwitch() {
  return screen.getByRole('switch', { name: /find best parameters/i })
}

describe('AutoMlToggles — Find Best Parameters enable/disable', () => {
  it('is enabled with exactly one algorithm selected, Find Best Model off', () => {
    render(<AutoMlToggles {...baseProps()} algorithms={['ridge']} />)
    expect(findBestParamsSwitch()).not.toBeDisabled()
    expect(
      screen.getByText(/tune this algorithm’s hyperparameters directly/i),
    ).toBeInTheDocument()
  })

  it('is disabled with zero algorithms selected, Find Best Model off', () => {
    render(<AutoMlToggles {...baseProps()} algorithms={[]} />)
    expect(findBestParamsSwitch()).toBeDisabled()
  })

  it('is disabled with two or more algorithms selected, Find Best Model off', () => {
    render(<AutoMlToggles {...baseProps()} algorithms={['ridge', 'ols']} />)
    expect(findBestParamsSwitch()).toBeDisabled()
  })

  it('stays enabled with Find Best Model on, regardless of algorithm count (unchanged sweep-winner path)', () => {
    render(
      <AutoMlToggles
        {...baseProps()}
        findBestModel
        algorithms={['ridge', 'ols']}
      />,
    )
    expect(findBestParamsSwitch()).not.toBeDisabled()
    expect(
      screen.getByText(/tune the sweep’s winning algorithm/i),
    ).toBeInTheDocument()
  })
})
