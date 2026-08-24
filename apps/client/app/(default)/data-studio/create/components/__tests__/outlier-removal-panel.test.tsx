import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutlierRemovalPanel } from '../outlier-removal-panel'
import type { Dataset } from '@/lib/preprocessing'
import type { ConditionalRule } from '@/lib/precleanse'
import type { PresetRangeCandidate } from '@/store/dataset-studio'

/**
 * DS-LAKE-020-T05/T06: the "Preset range cutoff" section this feature adds to
 * `outlier-removal-panel.tsx`. `OutlierRemovalPanel` takes no atoms — every
 * case here is driven entirely through props, no jotai Provider needed.
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

describe('OutlierRemovalPanel — Preset range cutoff', () => {
  it('renders nothing when there are no candidates for the visible tags', () => {
    render(<OutlierRemovalPanel {...baseProps()} presetRangeCandidates={[]} />)
    expect(screen.queryByText('Preset range cutoff')).toBeNull()
  })

  it('says why when there are no candidates because the preset predates range-cutoff support', () => {
    render(
      <OutlierRemovalPanel
        {...baseProps()}
        presetRangeCandidates={[]}
        presetRangeStale
      />,
    )
    expect(screen.getByText('Preset range cutoff')).toBeInTheDocument()
    expect(
      screen.getByText(/imported before range-cutoff support existed/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/re-import the same excel workbook/i),
    ).toBeInTheDocument()
  })

  it('prefers showing real candidates over the stale notice when both are present', () => {
    // A later Apply Preset that resolves to a fresh document should always
    // win the display — staleness is only ever surfaced when there is
    // nothing else to show.
    render(
      <OutlierRemovalPanel
        {...baseProps()}
        presetRangeCandidates={[CLOSED]}
        presetRangeStale
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )
    expect(screen.getByText('105-120 C')).toBeInTheDocument()
    expect(
      screen.queryByText(/imported before range-cutoff support existed/i),
    ).toBeNull()
  })

  it('shows the quoted range verbatim and provenance for a matching-unit candidate', () => {
    render(
      <OutlierRemovalPanel
        {...baseProps()}
        presetRangeCandidates={[CLOSED]}
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )
    expect(screen.getByText('Preset range cutoff')).toBeInTheDocument()
    expect(screen.getByText('105-120 C')).toBeInTheDocument()
    expect(screen.getByText(/s-204-no1 · config 1 · S-204/)).toBeInTheDocument()
  })

  it('V03: toggling a closed range ON emits two strict ConditionalRules with the resolved bound', async () => {
    const onConditionalChange = vi.fn()
    render(
      <OutlierRemovalPanel
        {...baseProps({ onConditionalChange })}
        presetRangeCandidates={[CLOSED]}
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )
    await userEvent.click(
      screen.getByRole('switch', {
        name: 'Toggle preset range cutoff for TI-101',
      }),
    )
    expect(onConditionalChange).toHaveBeenCalledTimes(1)
    const rules = onConditionalChange.mock.calls[0]![0] as ConditionalRule[]
    expect(rules).toHaveLength(2)
    const min = rules.find(r => r.op === '<')!
    const max = rules.find(r => r.op === '>')!
    expect(min.value).toBe(105)
    expect(max.value).toBe(120)
    expect(min.tag).toBe('TI-101')
    expect(min.action).toBe('mark')
    expect(min.source).toBe('preset-range')
    expect(min.presetRange).toEqual({
      presetId: 's-204-no1',
      configNo: 1,
      quoted: '105-120 C',
      unit: 'C',
    })
  })

  it('toggling OFF removes the preset-range rules for that tag and no others', async () => {
    const existing: ConditionalRule = {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'mark',
      enabled: true,
      source: 'preset-range',
      presetRange: {
        presetId: 's-204-no1',
        configNo: 1,
        quoted: '105-120 C',
        unit: 'C',
      },
    }
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
      <OutlierRemovalPanel
        {...baseProps({
          conditionalRules: [existing, handTyped],
          onConditionalChange,
        })}
        presetRangeCandidates={[CLOSED]}
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )
    const toggle = screen.getByRole('switch', {
      name: 'Toggle preset range cutoff for TI-101',
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(toggle)
    expect(onConditionalChange).toHaveBeenCalledWith([handTyped])
  })

  it('V02: disables the toggle and refuses to apply when the unit gate has no known conversion', () => {
    const unknownUnit: PresetRangeCandidate = {
      ...CLOSED,
      parsed: { ...CLOSED.parsed, unit: 'cP' },
    }
    render(
      <OutlierRemovalPanel
        {...baseProps()}
        presetRangeCandidates={[unknownUnit]}
        tagUnits={{ 'TI-101': 'C' }}
      />,
    )
    const toggle = screen.getByRole('switch', {
      name: 'Toggle preset range cutoff for TI-101',
    })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/no known conversion/i)).toBeInTheDocument()
  })

  it('shows the operating-window warning for an open-ended range', () => {
    render(
      <OutlierRemovalPanel
        {...baseProps()}
        presetRangeCandidates={[OPEN_ENDED]}
        tagUnits={{ 'TI-101': 'kg/hr' }}
      />,
    )
    expect(screen.getByText(/operating window/i)).toBeInTheDocument()
  })

  it('T06: warns that the labelled-row count cannot be checked before a target is chosen, once a cutoff is enabled', async () => {
    const active: ConditionalRule = {
      id: 'preset-range:TI-101:min',
      tag: 'TI-101',
      op: '<',
      value: 105,
      action: 'mark',
      enabled: true,
      source: 'preset-range',
      presetRange: {
        presetId: 's-204-no1',
        configNo: 1,
        quoted: '105-120 C',
        unit: 'C',
      },
    }
    render(
      <OutlierRemovalPanel
        {...baseProps({ conditionalRules: [active] })}
        presetRangeCandidates={[CLOSED]}
        tagUnits={{ 'TI-101': 'C' }}
        targetTag={null}
      />,
    )
    expect(screen.getByText(/target tag isn't chosen/i)).toBeInTheDocument()
  })
})
