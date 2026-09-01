import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SplitDistributionPanel } from '../split-distribution-panel'
import type { Algorithm } from '@/store/model-pipeline'

/**
 * MODEL-FLOW-014-T05. Covers the honest-state branches, which are pure
 * props -> render and need no network mock: the panel's own hook
 * (`useArtifactSplitStats`) never fires a request when `enabled` is false,
 * which every one of these cases hits before the hook's own state matters.
 * The `loading`/`missing`/`refusal`/`ready` branches (which DO depend on
 * the hook's fetched state) are exercised at V01-V08's own level, per the
 * plan's verification section — mocking the network here would duplicate
 * that coverage without adding a claim this file can prove better.
 */
function baseProps() {
  return {
    datasetId: 'ds-1',
    artifactId: 'art-1',
    hasArtifact: true,
    allTags: ['TI-101', 'PI-201', 'FI-301'],
    targetVariables: ['TI-101'],
    trainTestSplitPercent: 80,
    algorithms: ['ols'] as Algorithm[],
  }
}

describe('SplitDistributionPanel — honest states', () => {
  it('no dataset selected', () => {
    render(<SplitDistributionPanel {...baseProps()} datasetId={null} />)
    expect(
      screen.getByText(/No dataset selected — go back to Step 1\./),
    ).toBeInTheDocument()
  })

  it('no committed artifact', () => {
    render(
      <SplitDistributionPanel
        {...baseProps()}
        artifactId={null}
        hasArtifact={false}
      />,
    )
    expect(screen.getByText(/has no stored artifact yet/)).toBeInTheDocument()
  })

  it('zero target variables', () => {
    render(<SplitDistributionPanel {...baseProps()} targetVariables={[]} />)
    expect(
      screen.getByText(/Select a target variable above/),
    ).toBeInTheDocument()
  })

  it('more than one target variable', () => {
    render(
      <SplitDistributionPanel
        {...baseProps()}
        targetVariables={['TI-101', 'PI-201']}
      />,
    )
    expect(
      screen.getByText(/Select a single target variable/),
    ).toBeInTheDocument()
  })

  it('a sequence algorithm (lstm/gru) declines to describe a split it did not compute', () => {
    render(<SplitDistributionPanel {...baseProps()} algorithms={['lstm']} />)
    expect(
      screen.getByText(/cut the split by window, not by row/),
    ).toBeInTheDocument()
  })

  it('a mixed algorithm selection containing gru also declines', () => {
    render(
      <SplitDistributionPanel {...baseProps()} algorithms={['ols', 'gru']} />,
    )
    expect(
      screen.getByText(/cut the split by window, not by row/),
    ).toBeInTheDocument()
  })
})
