import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutlierRemovalPanel } from '../outlier-removal-panel'
import type { Dataset } from '@/lib/preprocessing'
import type { ConditionalRule } from '@/lib/precleanse'

/**
 * `OutlierRemovalPanel` (the Preset range cutoff cases moved to
 * `preset-range-card.test.tsx` with DS-LAKE-038). It takes no atoms — every
 * case here is driven entirely through props, no jotai Provider needed.
 */

const DATASET: Dataset = {
  tags: ['TI-101'],
  rows: [
    { timestamp: 't1', cells: { 'TI-101': { value: 110, status: 'Good' } } },
    { timestamp: 't2', cells: { 'TI-101': { value: 200, status: 'Good' } } }, // out of range
  ],
}

function baseProps(
  overrides: Partial<React.ComponentProps<typeof OutlierRemovalPanel>> = {},
) {
  return {
    tags: ['TI-101'],
    previewDataset: DATASET,
    rawTimestamps: ['t1', 't2'],
    cropRange: null,
    onCropChange: vi.fn(),
    conditionalRules: [] as ConditionalRule[],
    statisticalRules: [],
    onConditionalChange: vi.fn(),
    onStatisticalChange: vi.fn(),
    ...overrides,
  }
}

describe('OutlierRemovalPanel — preset range moved out (DS-LAKE-038)', () => {
  it('no longer renders the Preset range cutoff section - it lives in its own card', () => {
    render(<OutlierRemovalPanel {...baseProps()} />)
    expect(screen.queryByText('Preset range cutoff')).toBeNull()
  })

  it('still lists a preset-range rule, with a Clip | Exclude toggle and no Mark', async () => {
    const onConditionalChange = vi.fn()
    const rule: ConditionalRule = {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'clip',
      enabled: true,
      source: 'preset-range',
    }
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: [rule], onConditionalChange })}
      />,
    )
    expect(screen.getByText('Preset range')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clip' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    const [next] = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(next!.action).toBe('mark')
  })

  const PAIR: ConditionalRule[] = [
    {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'clip',
      enabled: true,
      source: 'preset-range',
      presetRange: {
        presetId: 'p',
        configNo: 1,
        quoted: '105-120 C',
        unit: 'C',
        original: 105,
      },
    },
    {
      id: 'preset-range:TI-101:max',
      tag: 'TI-101',
      op: '>',
      value: 120,
      action: 'clip',
      enabled: true,
      source: 'preset-range',
      presetRange: {
        presetId: 'p',
        configNo: 1,
        quoted: '105-120 C',
        unit: 'C',
        original: 120,
      },
    },
  ]
  const HAND: ConditionalRule = {
    id: 'hand',
    tag: 'TI-101',
    op: '==',
    value: 0,
    action: 'drop',
    enabled: true,
  }
  const low = () =>
    screen.getByRole('spinbutton', { name: 'TI-101 lower bound' })
  const high = () =>
    screen.getByRole('spinbutton', { name: 'TI-101 upper bound' })

  it('shows a preset-range PAIR as one editable row: TAG │ [low] ≤ x ≤ [high] unit', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [...PAIR, HAND],
          onConditionalChange,
        })}
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )

    expect(low()).toHaveValue(105)
    expect(high()).toHaveValue(120)
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.getAllByText('Preset range')).toHaveLength(1)
    // Tag and inputs are split by the drawn divider, hidden from readers.
    expect(
      screen.getByText('TI-101', { selector: 'span.truncate' })
        .nextElementSibling,
    ).toHaveAttribute('aria-hidden')
    // The hand rule keeps its own row and switch; the preset row has none.
    expect(screen.getAllByRole('switch')).toHaveLength(1)

    await userEvent.click(
      within(
        screen.getByRole('group', {
          name: 'What to do with TI-101 readings outside the range',
        }),
      ).getByRole('button', { name: 'Exclude' }),
    )
    const next = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(
      next.filter(r => r.source === 'preset-range').map(r => r.action),
    ).toEqual(['mark', 'mark'])
    expect(next.find(r => r.id === 'hand')).toEqual(HAND)
  })

  it('editing a bound writes only that bound, keeping its preset provenance', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: PAIR, onConditionalChange })}
      />,
    )
    await userEvent.clear(low())
    await userEvent.type(low(), '100')

    const last = onConditionalChange.mock.calls.at(-1)![0] as ConditionalRule[]
    expect(last.map(r => r.value)).toEqual([100, 120])
    expect(last[0]!.presetRange?.original).toBe(105)
  })

  it('refuses an impossible window: says so and writes nothing', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: PAIR, onConditionalChange })}
      />,
    )
    await userEvent.clear(low())
    await userEvent.type(low(), '130')

    expect(screen.getByRole('alert')).toHaveTextContent(/below high/i)
    // '1' and '13' were valid on the way; '130' (above 120) never landed.
    const values = onConditionalChange.mock.calls.map(
      c => (c[0] as ConditionalRule[])[0]!.value,
    )
    expect(values).not.toContain(130)
  })

  it('an emptied bound is never written', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: PAIR, onConditionalChange })}
      />,
    )
    await userEvent.clear(high())

    expect(screen.getByRole('alert')).toHaveTextContent(/enter a value/i)
    expect(onConditionalChange).not.toHaveBeenCalled()
  })

  it('an edited range shows Edited and resets to the preset numbers', async () => {
    const onConditionalChange = vi.fn()
    const edited = [{ ...PAIR[0]!, value: 100 }, PAIR[1]!]
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: edited, onConditionalChange })}
      />,
    )
    expect(screen.getByText('Edited')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Reset TI-101 to the preset range' }),
    )
    const next = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(next.map(r => r.value)).toEqual([105, 120])
  })

  it('an unedited range shows no Edited badge and no reset', () => {
    render(<OutlierRemovalPanel {...baseProps({ conditionalRules: PAIR })} />)
    expect(screen.queryByText('Edited')).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: 'Reset TI-101 to the preset range',
      }),
    ).toBeNull()
  })

  it('removing the preset row removes both bounds and keeps hand rules', async () => {
    const onConditionalChange = vi.fn()
    const min: ConditionalRule = {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'drop',
      enabled: true,
      source: 'preset-range',
    }
    const max: ConditionalRule = {
      ...min,
      id: 'preset-range:TI-101:max',
      op: '>',
      value: 120,
    }
    const hand: ConditionalRule = {
      id: 'hand',
      tag: 'TI-101',
      op: '==',
      value: 0,
      action: 'mark',
      enabled: true,
    }
    render(
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [min, max, hand],
          onConditionalChange,
        })}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove preset range for TI-101' }),
    )
    expect(onConditionalChange).toHaveBeenCalledWith([hand])
  })

  it('a pair with mixed actions lights neither segment', () => {
    const base: ConditionalRule = {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'clip',
      enabled: true,
      source: 'preset-range',
    }
    render(
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [
            base,
            {
              ...base,
              id: 'preset-range:TI-101:max',
              op: '>',
              value: 120,
              action: 'drop',
            },
          ],
        })}
      />,
    )
    for (const name of ['Clip', 'Exclude']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
  })

  describe('a condition the user writes: Clip | Exclude, like the cleaning toolkit', () => {
    const hand = (extra: Partial<ConditionalRule> = {}): ConditionalRule => ({
      id: 'hand',
      tag: 'TI-101',
      op: '>',
      value: 500,
      action: 'mark',
      enabled: true,
      ...extra,
    })
    const toggle = () =>
      screen.getByRole('group', { name: 'What to do with matching readings' })

    it('offers Clip and Exclude, and no Mark or Drop', () => {
      render(
        <OutlierRemovalPanel {...baseProps({ conditionalRules: [hand()] })} />,
      )
      expect(
        within(toggle()).getByRole('button', { name: 'Clip' }),
      ).toBeInTheDocument()
      expect(
        within(toggle()).getByRole('button', { name: 'Exclude' }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByText('Mark')).toBeNull()
      expect(screen.queryByText('Drop')).toBeNull()
    })

    it('Clip writes the clip action; Exclude writes mark (Bad, value kept)', async () => {
      const onConditionalChange = vi.fn()
      render(
        <OutlierRemovalPanel
          {...baseProps({ conditionalRules: [hand()], onConditionalChange })}
        />,
      )
      await userEvent.click(
        within(toggle()).getByRole('button', { name: 'Clip' }),
      )
      expect(
        (onConditionalChange.mock.calls[0]![0] as ConditionalRule[])[0]!.action,
      ).toBe('clip')
    })

    it('a condition saved with drop shows as Exclude', () => {
      render(
        <OutlierRemovalPanel
          {...baseProps({ conditionalRules: [hand({ action: 'drop' })] })}
        />,
      )
      expect(
        within(toggle()).getByRole('button', { name: 'Exclude' }),
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('a Range or == condition offers only Exclude - there is no bound to clip to', () => {
      render(
        <OutlierRemovalPanel
          {...baseProps({
            conditionalRules: [
              hand({ id: 'a', op: '<', lower: { value: 200, op: '<=' } }),
            ],
          })}
        />,
      )
      expect(
        within(toggle()).queryByRole('button', { name: 'Clip' }),
      ).toBeNull()
      expect(
        within(toggle()).getByRole('button', { name: 'Exclude' }),
      ).toBeInTheDocument()
    })

    it('turning Range on while set to Clip switches the condition to Exclude', async () => {
      const onConditionalChange = vi.fn()
      render(
        <OutlierRemovalPanel
          {...baseProps({
            conditionalRules: [hand({ action: 'clip', op: '<' })],
            onConditionalChange,
          })}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: /range/i }))
      const [next] = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
      expect(next!.lower).toBeDefined()
      expect(next!.action).toBe('mark')
    })

    it('an SD&TA condition keeps its own toggle', () => {
      render(
        <OutlierRemovalPanel
          {...baseProps({
            conditionalRules: [hand({ source: 'sdta', action: 'drop_row' })],
          })}
        />,
      )
      expect(
        screen.queryByRole('group', {
          name: 'What to do with matching readings',
        }),
      ).toBeNull()
      expect(screen.getByText('Mark')).toBeInTheDocument()
    })
  })
})

/** DS-LAKE-032-T10 / D09 — the Range toggle on conditional rules. */
describe('OutlierRemovalPanel — conditional Range rule', () => {
  const rule = (extra: Partial<ConditionalRule> = {}): ConditionalRule => ({
    id: 'r1',
    tag: 'TI-101',
    op: '>',
    value: 500,
    action: 'mark',
    enabled: true,
    ...extra,
  })

  it('turning Range on adds an empty <= lower bound and pulls op into < / <=', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: [rule()], onConditionalChange })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /range/i }))
    const [next] = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(next!.lower).toEqual({ value: '', op: '<=' })
    expect(next!.op).toBe('<')
  })

  it('turning Range off deletes `lower`, leaving a plain single-op rule', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [
            rule({ op: '<', lower: { value: 200, op: '<=' } }),
          ],
          onConditionalChange,
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /range/i }))
    const [next] = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect('lower' in next!).toBe(false)
  })

  it('offers no Range toggle on a preset-authored rule', () => {
    render(
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [rule({ source: 'sdta' })],
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /range/i })).toBeNull()
  })
})
