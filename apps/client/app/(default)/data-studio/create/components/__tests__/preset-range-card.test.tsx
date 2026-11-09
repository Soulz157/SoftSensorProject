import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PresetRangeCard } from '../preset-range-card'
import type { Dataset } from '@/lib/preprocessing'
import type { ConditionalRule } from '@/lib/precleanse'
import type { PresetRangeCandidate } from '@/store/dataset-studio'

/**
 * DS-LAKE-020-T05/T06 (moved here from the outlier panel test) and DS-LAKE-038:
 * the Preset range card. It takes no atoms - every case is driven by props.
 */

const DATASET: Dataset = {
  tags: ['TI-101'],
  rows: [
    { timestamp: 't1', cells: { 'TI-101': { value: 110, status: 'Good' } } },
    { timestamp: 't2', cells: { 'TI-101': { value: 200, status: 'Good' } } }, // out of range
  ],
}

const CLOSED: PresetRangeCandidate = {
  tag: 'TI-101',
  rowLabel: 'TI-101',
  quotedRange: '105-120 C',
  parsed: { kind: 'closed', min: 105, max: 120, unit: 'C', raw: '105-120 C' },
  presetId: 's-204-no1',
  configNo: 1,
  sheet: 'S-204',
}

const OPEN_ENDED: PresetRangeCandidate = {
  tag: 'TI-101',
  rowLabel: 'TI-101',
  quotedRange: '>21500 kg/hr',
  parsed: {
    kind: 'lower',
    min: 21500,
    max: null,
    unit: 'kg/hr',
    raw: '>21500 kg/hr',
  },
  presetId: 's-204-no1',
  configNo: 1,
  sheet: 'S-204',
}

const PROVENANCE = {
  presetId: 's-204-no1',
  configNo: 1,
  quoted: '105-120 C',
  unit: 'C',
}

function presetRule(
  bound: 'min' | 'max',
  action: ConditionalRule['action'],
  over: Partial<ConditionalRule> = {},
): ConditionalRule {
  return {
    id: `preset-range:TI-101:${bound}`,
    tag: 'TI-101',
    op: bound === 'min' ? '<' : '>',
    value: bound === 'min' ? 105 : 120,
    action,
    enabled: true,
    source: 'preset-range',
    presetRange: PROVENANCE,
    ...over,
  }
}

function baseProps(
  overrides: Partial<React.ComponentProps<typeof PresetRangeCard>> = {},
) {
  return {
    candidates: [CLOSED],
    stale: false,
    tags: ['TI-101'],
    scopeTag: undefined,
    tagUnits: { 'TI-101': 'C' },
    previewDataset: DATASET,
    conditionalRules: [] as ConditionalRule[],
    onConditionalChange: vi.fn(),
    targetTag: null,
    ...overrides,
  }
}

const checkbox = () =>
  screen.getByRole('checkbox', {
    name: 'Toggle preset range cutoff for TI-101',
  })

describe('PresetRangeCard — visibility', () => {
  it('renders nothing when there are no candidates for the frame tags', () => {
    const { container } = render(
      <PresetRangeCard {...baseProps({ candidates: [] })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says why when there are no candidates because the preset predates range-cutoff support', () => {
    render(<PresetRangeCard {...baseProps({ candidates: [], stale: true })} />)
    expect(screen.getByText('Preset range cutoff')).toBeInTheDocument()
    expect(
      screen.getByText(/imported before range-cutoff support existed/i),
    ).toBeInTheDocument()
  })

  it('prefers real candidates over the stale notice when both are present', () => {
    render(<PresetRangeCard {...baseProps({ stale: true })} />)
    expect(
      screen.queryByText(/imported before range-cutoff support existed/i),
    ).toBeNull()
    expect(checkbox()).toBeInTheDocument()
  })

  it('lists candidates for every frame tag even when Step 5 isolates a tag with none', () => {
    const other: PresetRangeCandidate = {
      ...CLOSED,
      tag: 'FIC505.PV',
      rowLabel: 'FIC505.PV',
      quotedRange: '45 - 95',
      parsed: { kind: 'closed', min: 45, max: 95, unit: null, raw: '45 - 95' },
    }
    render(
      <PresetRangeCard
        {...baseProps({
          candidates: [CLOSED, other],
          tags: ['TI-101', 'FIC505.PV', 's611water.lab'],
          scopeTag: 's611water.lab',
        })}
      />,
    )
    expect(screen.getByText('105 ≤ x ≤ 120 C')).toBeInTheDocument()
    expect(screen.getByText('45 ≤ x ≤ 95')).toBeInTheDocument()
  })
})

describe('PresetRangeCard — how a row reads', () => {
  it('shows the KEPT WINDOW on one line, with the quoted text and provenance only in the tooltip', () => {
    render(<PresetRangeCard {...baseProps()} />)
    const window = screen.getByText('105 ≤ x ≤ 120 C')
    expect(window).toBeInTheDocument()
    // No description line under the row any more.
    expect(screen.queryByText(/quoted/i)).toBeNull()
    expect(screen.queryByText(/s-204-no1/)).toBeNull()
    // Still reachable on hover, from the row's label.
    const label = window.closest('label')!
    expect(label).toHaveAttribute(
      'title',
      expect.stringContaining('Quoted: 105-120 C'),
    )
    expect(label.getAttribute('title')).toContain(
      's-204-no1 · config 1 · S-204',
    )
  })

  it('separates the tag from its window with a drawn divider', () => {
    render(<PresetRangeCard {...baseProps()} />)
    const window = screen.getByText('105 ≤ x ≤ 120 C')
    // The window sits in a cell with room for the Edited badge.
    const divider = window.parentElement!.previousElementSibling!
    expect(divider).toHaveAttribute('aria-hidden')
    expect(divider.previousElementSibling).toHaveTextContent('TI-101')
  })

  it('shows no per-row point counts', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'mark'),
            presetRule('max', 'mark'),
          ],
        })}
      />,
    )
    expect(screen.queryByText(/pts/)).toBeNull()
    expect(screen.queryByText(/clamped|dropped/i)).toBeNull()
  })

  it('the tag and window are one click target that toggles the row', async () => {
    const onConditionalChange = vi.fn()
    render(<PresetRangeCard {...baseProps({ onConditionalChange })} />)
    await userEvent.click(screen.getByText('105 ≤ x ≤ 120 C'))
    expect(onConditionalChange).toHaveBeenCalledTimes(1)
  })

  it('reads an open-ended range with one operator and warns it is an operating window', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          candidates: [OPEN_ENDED],
          tagUnits: { 'TI-101': 'kg/hr' },
        })}
      />,
    )
    expect(screen.getByText('x ≥ 21500 kg/hr')).toBeInTheDocument()
    expect(screen.getByText(/operating window/i)).toBeInTheDocument()
  })

  it('V02: disables the row and refuses to apply when the unit gate has no known conversion', () => {
    const unknownUnit: PresetRangeCandidate = {
      ...CLOSED,
      parsed: { ...CLOSED.parsed, unit: 'cP' },
    }
    render(<PresetRangeCard {...baseProps({ candidates: [unknownUnit] })} />)
    expect(checkbox()).toBeDisabled()
    // One short line on the row; the full reason is on hover.
    const reason = screen.getByText(/unit mismatch \(cP → C\)/i)
    expect(reason.closest('p')).toHaveAttribute(
      'title',
      expect.stringMatching(/no known conversion/i),
    )
    // The quoted text stands in for a window that was never applied.
    expect(screen.getByText('105-120 C')).toBeInTheDocument()
  })

  it('offers Clip and Exclude, and no Mark or Drop', () => {
    render(<PresetRangeCard {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Clip' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exclude' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull()
  })
})

describe('PresetRangeCard — enabling and the action', () => {
  // A CRITICAL tag defaults to Clip; a non-critical one to Exclude (see the
  // critical-tag suggestion block below).
  it('V03: enabling emits two strict rules with the resolved bound, defaulting to Clip for a critical tag', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({ onConditionalChange, criticalTags: ['TI-101'] })}
      />,
    )
    await userEvent.click(checkbox())

    expect(onConditionalChange).toHaveBeenCalledTimes(1)
    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules).toHaveLength(2)
    const min = rules.find(r => r.op === '<')!
    const max = rules.find(r => r.op === '>')!
    expect([min.value, max.value]).toEqual([105, 120])
    expect(min.action).toBe('clip')
    expect(max.action).toBe('clip')
    expect(min.source).toBe('preset-range')
    // Each bound records the preset's own value, so an edit can be shown.
    expect(min.presetRange).toEqual({ ...PROVENANCE, original: 105 })
    expect(max.presetRange).toEqual({ ...PROVENANCE, original: 120 })
  })

  it('picking Exclude BEFORE enabling carries into the rules it emits', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({ onConditionalChange, criticalTags: ['TI-101'] })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    // Not enabled yet, so choosing an action writes nothing.
    expect(onConditionalChange).not.toHaveBeenCalled()

    await userEvent.click(checkbox())
    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules.map(r => r.action)).toEqual(['mark', 'mark'])
  })

  it('switching Clip to Exclude on an enabled row rewrites BOTH bounds, keeping their values', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip'),
            presetRule('max', 'clip'),
          ],
          onConditionalChange,
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Clip' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))

    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules.map(r => [r.op, r.value, r.action])).toEqual([
      ['<', 105, 'mark'],
      ['>', 120, 'mark'],
    ])
    expect(rules[0]!.presetRange).toEqual(PROVENANCE)
  })

  it('toggling OFF removes the preset-range rules for that tag and no others', async () => {
    const handTyped: ConditionalRule = {
      id: 'hand-1',
      tag: 'TI-101',
      op: '==',
      value: 0,
      action: 'drop',
      enabled: true,
    }
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [presetRule('min', 'clip'), handTyped],
          onConditionalChange,
        })}
      />,
    )
    expect(checkbox()).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(checkbox())
    expect(onConditionalChange).toHaveBeenCalledWith([handTyped])
  })

  it('a rule an earlier build saved with action drop reads as Exclude', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'drop'),
            presetRule('max', 'drop'),
          ],
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('a pair with different actions says so, highlights neither, and one click aligns both', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip'),
            presetRule('max', 'mark'),
          ],
          onConditionalChange,
        })}
      />,
    )
    expect(screen.getByText(/different actions/i)).toBeInTheDocument()
    for (const name of ['Clip', 'Exclude']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
    await userEvent.click(screen.getByRole('button', { name: 'Clip' }))
    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules.map(r => r.action)).toEqual(['clip', 'clip'])
  })
})

describe('PresetRangeCard — header and guards', () => {
  it('the header counts enabled rows, beside the title', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip'),
            presetRule('max', 'clip'),
          ],
        })}
      />,
    )
    expect(screen.getByText('1 of 1 enabled')).toBeInTheDocument()
  })

  it('T06: warns the labelled-row count cannot be checked before a target is chosen - for a DROP', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [presetRule('min', 'mark')],
          targetTag: null,
        })}
      />,
    )
    expect(screen.getByText(/target tag isn't chosen/i)).toBeInTheDocument()
  })

  it('a CLIP loses no rows, so it raises neither warning nor refusal', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip', { value: 1000 }),
            presetRule('max', 'clip', { value: 2000 }),
          ],
          targetTag: null,
        })}
      />,
    )
    expect(screen.queryByText(/target tag isn't chosen/i)).toBeNull()
    expect(screen.queryByText(/lose a reading/i)).toBeNull()
  })

  it('refuses a DROP bound that would empty the frame', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'mark', { value: 1000 }),
            presetRule('max', 'mark', { value: 2000 }),
          ],
        })}
      />,
    )
    expect(
      screen.getByText(/every row would lose a reading/i),
    ).toBeInTheDocument()
  })

  it('keeps each row inside its own list item', () => {
    render(<PresetRangeCard {...baseProps()} />)
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('TI-101')).toBeInTheDocument()
    // Clip, Exclude and the suggestion's tooltip trigger.
    expect(within(row).getAllByRole('button')).toHaveLength(3)
  })
})

describe('PresetRangeCard — critical-tag suggestion', () => {
  const suggestion = () =>
    screen.getByRole('button', { name: /^Suggested for TI-101:/ })
  const enabledActions = (fn: ReturnType<typeof vi.fn>) =>
    (fn.mock.calls[0]![0] as ConditionalRule[]).map(r => r.action)

  it('suggests and defaults to Exclude for a tag that is not critical', async () => {
    const onConditionalChange = vi.fn()
    render(<PresetRangeCard {...baseProps({ onConditionalChange })} />)
    expect(suggestion()).toHaveTextContent('Suggested: Exclude')
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(checkbox())
    expect(enabledActions(onConditionalChange)).toEqual(['mark', 'mark'])
  })

  it('suggests and defaults to Clip for a critical tag', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({ onConditionalChange, criticalTags: ['TI-101'] })}
      />,
    )
    expect(suggestion()).toHaveTextContent('Suggested: Clip')
    await userEvent.click(checkbox())
    expect(enabledActions(onConditionalChange)).toEqual(['clip', 'clip'])
  })

  it('explains the suggestion in a tooltip, and where critical tags are set', async () => {
    render(<PresetRangeCard {...baseProps({ criticalTags: ['TI-101'] })} />)
    await userEvent.hover(suggestion())
    const tips = await screen.findAllByRole('tooltip')
    expect(tips[0]).toHaveTextContent(/Critical tag: Clip clamps/)
    expect(tips[0]).toHaveTextContent(/star in Step 1/)
  })

  it('an untouched row follows a tag starred later; an explicit pick is kept', async () => {
    const { rerender } = render(<PresetRangeCard {...baseProps()} />)
    rerender(<PresetRangeCard {...baseProps({ criticalTags: ['TI-101'] })} />)
    expect(screen.getByRole('button', { name: 'Clip' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    rerender(<PresetRangeCard {...baseProps({ criticalTags: [] })} />)
    rerender(<PresetRangeCard {...baseProps({ criticalTags: ['TI-101'] })} />)
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('never rewrites an ENABLED row when the critical list changes', () => {
    const onConditionalChange = vi.fn()
    const rules = [presetRule('min', 'mark'), presetRule('max', 'mark')]
    const { rerender } = render(
      <PresetRangeCard
        {...baseProps({ onConditionalChange, conditionalRules: rules })}
      />,
    )
    rerender(
      <PresetRangeCard
        {...baseProps({
          onConditionalChange,
          conditionalRules: rules,
          criticalTags: ['TI-101'],
        })}
      />,
    )
    expect(onConditionalChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('says what going against the suggestion costs, without a warning icon', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'mark'),
            presetRule('max', 'mark'),
          ],
          criticalTags: ['TI-101'],
        })}
      />,
    )
    expect(screen.getByText(/Critical tag set to Exclude/)).toBeInTheDocument()
  })

  it('says nothing extra when the row follows the suggestion', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip'),
            presetRule('max', 'clip'),
          ],
          criticalTags: ['TI-101'],
        })}
      />,
    )
    expect(screen.queryByText(/Critical tag set to Exclude/)).toBeNull()
    expect(screen.queryByText(/Clip on a non-critical tag/)).toBeNull()
  })

  it('does not point at Step 1 as editable in edit mode', async () => {
    render(<PresetRangeCard {...baseProps({ editMode: true })} />)
    await userEvent.hover(suggestion())
    const tips = await screen.findAllByRole('tooltip')
    expect(tips[0]).toHaveTextContent(/locked while editing/)
  })
})

describe('PresetRangeCard — edit mode', () => {
  it('says an edit-mode save does not apply the cutoffs server-side', () => {
    render(<PresetRangeCard {...baseProps({ editMode: true })} />)
    expect(
      screen.getByText(
        /saving an edit does not apply them to the stored rows/i,
      ),
    ).toBeInTheDocument()
  })

  it('stays quiet in create mode', () => {
    render(<PresetRangeCard {...baseProps()} />)
    expect(screen.queryByText(/saving an edit/i)).toBeNull()
  })
})

describe('PresetRangeCard — a range edited in Outlier Removal', () => {
  const edited = (action: ConditionalRule['action'] = 'clip') => [
    presetRule('min', action, {
      value: 100,
      presetRange: { ...PROVENANCE, original: 105 },
    }),
    presetRule('max', action, {
      presetRange: { ...PROVENANCE, original: 120 },
    }),
  ]

  it('shows the CURRENT numbers, an Edited badge, and what the preset said', () => {
    render(<PresetRangeCard {...baseProps({ conditionalRules: edited() })} />)

    expect(screen.getByText('100 ≤ x ≤ 120 C')).toBeInTheDocument()
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByText(/Edited in Outlier Removal/)).toBeInTheDocument()
    expect(screen.getByText('105 ≤ x ≤ 120 C')).toBeInTheDocument()
  })

  it('Reset puts the preset numbers back and keeps the action', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: edited('mark'),
          onConditionalChange,
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules.map(r => [r.op, r.value, r.action])).toEqual([
      ['<', 105, 'mark'],
      ['>', 120, 'mark'],
    ])
  })

  it('switching Clip/Exclude keeps the edited numbers', async () => {
    const onConditionalChange = vi.fn()
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: edited('clip'),
          onConditionalChange,
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))

    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules.map(r => [r.value, r.action])).toEqual([
      [100, 'mark'],
      [120, 'mark'],
    ])
  })

  it('an unedited enabled range shows no Edited state', () => {
    render(
      <PresetRangeCard
        {...baseProps({
          conditionalRules: [
            presetRule('min', 'clip', {
              presetRange: { ...PROVENANCE, original: 105 },
            }),
            presetRule('max', 'clip', {
              presetRange: { ...PROVENANCE, original: 120 },
            }),
          ],
        })}
      />,
    )
    expect(screen.queryByText('Edited')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })
})
