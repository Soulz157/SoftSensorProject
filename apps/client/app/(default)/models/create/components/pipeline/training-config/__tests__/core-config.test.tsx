import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoreConfig } from '../core-config'
import type { Algorithm } from '@/store/model-pipeline'

/** MODEL-FLOW-014-T07. The Seed control's own behaviour — clamping,
 * undefined-vs-explicit distinction, and per-algorithm "ignored by" truth
 * via `seedConsumedBy`. */
function baseProps() {
  return {
    tags: ['TI-101', 'PI-201'],
    targetVariables: ['TI-101'],
    onTargetChange: vi.fn(),
    lossFunction: 'mse',
    onLossChange: vi.fn(),
    trainTestSplit: 80,
    onSplitChange: vi.fn(),
    seed: undefined,
    onSeedChange: vi.fn(),
    algorithms: ['random_forest'] as Algorithm[],
    // MODEL-FLOW-016-T10. datasetId/artifactId null keeps CvControl's own
    // useArtifactSplitStats/useArtifactHoldout calls disabled (both hooks'
    // own `enabled` gates require both non-null) — these Seed-control
    // tests have no dataset fixture and must not trigger a real fetch.
    nSplits: undefined,
    onNSplitsChange: vi.fn(),
    findBestModel: false,
    datasetId: null,
    artifactId: null,
    hasArtifact: false,
    maxAdmissibleK: null,
    splitStatsLoading: false,
  }
}

describe('CoreConfig — Seed control', () => {
  it('renders empty with the auto placeholder when seed is undefined', () => {
    render(<CoreConfig {...baseProps()} />)
    const input = screen.getByLabelText(/seed/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toMatch(/auto/i)
  })

  it('renders the explicit value when seed is set, distinct from empty/undefined', () => {
    render(<CoreConfig {...baseProps()} seed={4242} />)
    const input = screen.getByLabelText(/seed/i) as HTMLInputElement
    expect(input.value).toBe('4242')
  })

  it('clearing the field calls onSeedChange with undefined, not 0 or NaN', () => {
    const onSeedChange = vi.fn()
    render(
      <CoreConfig {...baseProps()} seed={4242} onSeedChange={onSeedChange} />,
    )
    const input = screen.getByLabelText(/seed/i)
    fireEvent.change(input, { target: { value: '' } })
    expect(onSeedChange).toHaveBeenCalledWith(undefined)
  })

  it('clamps a value above the schema max (2147483646)', () => {
    const onSeedChange = vi.fn()
    render(<CoreConfig {...baseProps()} onSeedChange={onSeedChange} />)
    const input = screen.getByLabelText(/seed/i)
    fireEvent.change(input, { target: { value: '9999999999' } })
    expect(onSeedChange).toHaveBeenCalledWith(2147483646)
  })

  it('clamps a value below the schema min (1)', () => {
    const onSeedChange = vi.fn()
    render(<CoreConfig {...baseProps()} onSeedChange={onSeedChange} />)
    const input = screen.getByLabelText(/seed/i)
    fireEvent.change(input, { target: { value: '0' } })
    expect(onSeedChange).toHaveBeenCalledWith(1)
  })

  it('states both halves — what the seed controls and what it does not', () => {
    render(<CoreConfig {...baseProps()} />)
    expect(screen.getByText(/estimator's own randomness/i)).toBeInTheDocument()
    // "not" renders in its own <span>, so the sentence spans multiple text
    // nodes — match on the paragraph's combined textContent instead of a
    // single getByText regex, which only matches one text node at a time.
    expect(
      screen.getByText((_content, element) =>
        Boolean(
          element?.tagName === 'P' &&
          /control the train\/test boundary/i.test(element.textContent ?? '') &&
          /\bnot\b/i.test(element.textContent ?? ''),
        ),
      ),
    ).toBeInTheDocument()
  })

  it('shows NO "ignored by" hint for an algorithm that consumes the seed', () => {
    render(<CoreConfig {...baseProps()} algorithms={['random_forest']} />)
    expect(screen.queryByText(/ignored by/i)).not.toBeInTheDocument()
  })

  it('names ridge in the "ignored by" hint — train.py never passes it random_state', () => {
    render(<CoreConfig {...baseProps()} algorithms={['ridge']} />)
    expect(screen.getByText(/ignored by/i)).toBeInTheDocument()
    expect(screen.getByText(/Ridge Regression/)).toBeInTheDocument()
  })
})
