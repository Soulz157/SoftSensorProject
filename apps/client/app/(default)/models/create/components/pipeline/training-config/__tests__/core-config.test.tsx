import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoreConfig } from '../core-config'
import {
  DEFAULT_LOSS_FUNCTION,
  LOSS_OPTIONS,
  normaliseLossFunction,
} from '@/lib/training-config'
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
    // MODEL-FLOW-019-T11. Empty means no ratio criterion set anywhere — the
    // advisory default; these Seed-control tests don't exercise it.
    acceptanceCriteria: [],
    onAcceptanceCriteriaChange: vi.fn(),
    currentRunMetrics: null,
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

/**
 * MODEL-FLOW-019-T37. The Loss control must SHOW something.
 *
 * This is the observation that opened the task, kept as a guard. A Radix
 * `Select` whose value matches no `SelectItem` renders an EMPTY trigger, and
 * the wizard's default was `'mse'`, which `LOSS_OPTIONS` does not offer.
 * Measured before the fix: `'mse'` and `''` both produced `""`,
 * indistinguishable from each other, while `'rmse'` and `'mae'` produced
 * their labels.
 *
 * Asserted through the rendered TRIGGER rather than through the prop, because
 * the prop was never the problem — every value here is a perfectly good
 * string, and only the render told the truth.
 */
describe('CoreConfig — Loss function control (MODEL-FLOW-019-T37)', () => {
  /** The Loss trigger, found by its own label rather than by position — a
   *  `getAllByRole('combobox')[1]` would silently follow any reordering of
   *  the controls above it. */
  function lossTrigger() {
    return screen.getByLabelText('Loss function')
  }

  it.each(LOSS_OPTIONS)(
    'renders the label for the offered value $value',
    ({ value, label }) => {
      render(<CoreConfig {...baseProps()} lossFunction={value} />)
      expect(lossTrigger()).toHaveTextContent(label)
    },
  )

  it('renders a label for the wizard default, never an empty control', () => {
    // The regression itself: with the old default this trigger was blank.
    render(<CoreConfig {...baseProps()} lossFunction={DEFAULT_LOSS_FUNCTION} />)
    expect(lossTrigger().textContent?.trim()).not.toBe('')
    expect(lossTrigger()).toHaveTextContent('RMSE')
  })

  /**
   * MEASURED, AND IT DEFEATS THE OBVIOUS BACKSTOP — recorded so the next
   * reader does not add the same one twice.
   *
   * A `SelectValue placeholder` does NOT rescue an unmatched value. Radix
   * treats a value that is set-but-matching-nothing as "this control has a
   * value" and renders the (non-existent) item's text, i.e. nothing at all;
   * the placeholder fires only when the value is genuinely empty. Probed
   * directly: `'mse'` renders `""` WITH the placeholder present, while `''`
   * renders `"Select a metric"`.
   *
   * So the placeholder is worth having — it converts one silent-blank case
   * into a stated one — but it is NOT what protects this control. That is
   * `normaliseLossFunction`, applied at every path that writes the atom. This
   * pair of cases pins both halves of that finding so the guarantee is not
   * over-claimed.
   */
  it('renders NOTHING for a set-but-unoffered value — the placeholder does not cover this', () => {
    render(<CoreConfig {...baseProps()} lossFunction="mse" />)
    expect(lossTrigger().textContent?.trim()).toBe('')
  })

  it('normalising that same legacy value first is what makes it render', () => {
    render(
      <CoreConfig
        {...baseProps()}
        lossFunction={normaliseLossFunction('mse')}
      />,
    )
    expect(lossTrigger()).toHaveTextContent('RMSE')
  })

  it('falls back to the placeholder only when the value is genuinely empty', () => {
    render(<CoreConfig {...baseProps()} lossFunction="" />)
    expect(lossTrigger()).toHaveTextContent('Select a metric')
  })

  it('still reports the user’s own choice upward', () => {
    const onLossChange = vi.fn()
    render(
      <CoreConfig
        {...baseProps()}
        lossFunction="rmse"
        onLossChange={onLossChange}
      />,
    )
    expect(lossTrigger()).toHaveTextContent('RMSE')
    expect(onLossChange).not.toHaveBeenCalled()
  })
})
