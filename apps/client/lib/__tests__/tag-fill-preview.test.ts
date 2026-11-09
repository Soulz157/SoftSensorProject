import { describe, it, expect } from 'vitest'
import {
  preprocessPipelines,
  tagFillPreview,
  type CleaningStep,
  type Dataset,
} from '@/lib/preprocessing'
import { precleanse, type ConditionalRule } from '@/lib/precleanse'

const TAG = 'TI-101'

function frame(values: number[]): Dataset {
  return {
    tags: [TAG],
    rows: values.map((value, i) => ({
      timestamp: `2026-01-01 0${i}:00:00`,
      cells: { [TAG]: { value, status: 'Good' as const } },
    })),
  }
}

function presetRange(
  op: ConditionalRule['op'],
  value: number,
  action: ConditionalRule['action'],
): ConditionalRule {
  return {
    id: `r-${op}-${value}`,
    tag: TAG,
    op,
    value,
    action,
    enabled: true,
    source: 'preset-range',
  }
}

function rulesOnly(raw: Dataset, rules: ConditionalRule[]): Dataset {
  return precleanse(raw, { crop: null, conditional: rules, statistical: [] })
}

describe('tagFillPreview — Before & After Preview in Step 5', () => {
  it('shows a Preset range Exclude as a gap in Cleaned, not in Original', () => {
    const raw = frame([10, 50, 12])
    const base = rulesOnly(raw, [presetRange('>', 40, 'mark')])
    const rows = tagFillPreview(raw, base, TAG)
    expect(rows.map(r => r.before)).toEqual([10, 50, 12])
    expect(rows.map(r => r.after)).toEqual([10, null, 12])
  })

  it('shows a Preset range Clip as the clamped value in Cleaned', () => {
    const raw = frame([10, 50, 12])
    const base = rulesOnly(raw, [presetRange('>', 40, 'clip')])
    const rows = tagFillPreview(raw, base, TAG)
    expect(rows.map(r => r.before)).toEqual([10, 50, 12])
    expect(rows.map(r => r.after)).toEqual([10, 40, 12])
  })

  it('shows a toolkit Exclude Range as a gap, and a later fill fills it', () => {
    const raw = frame([10, 50, 12])
    const exclude: CleaningStep = {
      uid: 'x',
      category: 'outliers',
      method: 'exclude',
      paramLow: 40,
      param: 60,
    }
    const fill: CleaningStep = {
      uid: 'f',
      category: 'missing',
      method: 'forward',
    }

    const excluded = preprocessPipelines(raw, { [TAG]: [exclude] })
    expect(tagFillPreview(raw, excluded, TAG).map(r => r.after)).toEqual([
      10,
      null,
      12,
    ])

    const filled = preprocessPipelines(raw, { [TAG]: [exclude, fill] })
    expect(tagFillPreview(raw, filled, TAG).map(r => r.after)).toEqual([
      10, 10, 12,
    ])
  })

  it('stacks rules and toolkit steps: Preset Exclude then Forward Fill', () => {
    const raw = frame([10, 50, 12])
    const base = rulesOnly(raw, [presetRange('>', 40, 'mark')])
    const fill: CleaningStep = {
      uid: 'f',
      category: 'missing',
      method: 'forward',
    }
    const processed = preprocessPipelines(base, { [TAG]: [fill] })
    const rows = tagFillPreview(raw, processed, TAG)
    expect(rows.map(r => r.before)).toEqual([10, 50, 12])
    expect(rows.map(r => r.after)).toEqual([10, 10, 12])
  })

  it('leaves Cleaned equal to Original when nothing is applied', () => {
    const raw = frame([10, 50, 12])
    const rows = tagFillPreview(raw, rulesOnly(raw, []), TAG)
    expect(rows.every(r => r.before === r.after)).toBe(true)
  })
})
