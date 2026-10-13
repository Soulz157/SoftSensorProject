import { describe, expect, it } from 'vitest'
import { toPresetRangeOperations } from '@/lib/cleaning-op-mapper'
import type { ConditionalAction, ConditionalRule } from '@/lib/precleanse'

function rule(
  tag: string,
  bound: 'min' | 'max',
  value: number,
  action: ConditionalAction,
  over: Partial<ConditionalRule> = {},
): ConditionalRule {
  return {
    id: `preset-range:${tag}:${bound}`,
    tag,
    op: bound === 'min' ? '<' : '>',
    value,
    action,
    enabled: true,
    source: 'preset-range',
    ...over,
  }
}

describe('toPresetRangeOperations (DS-LAKE-038)', () => {
  it('an Exclude pair becomes ONE range_exclude carrying both bounds', () => {
    expect(
      toPresetRangeOperations([
        rule('FIC-101', 'min', 30, 'mark'),
        rule('FIC-101', 'max', 100, 'mark'),
      ]),
    ).toEqual([
      { type: 'range_exclude', tags: ['FIC-101'], paramLow: 30, param: 100 },
    ])
  })

  it('a Clip pair becomes ONE clip, not a range_exclude', () => {
    expect(
      toPresetRangeOperations([
        rule('FIC-101', 'min', 30, 'clip'),
        rule('FIC-101', 'max', 100, 'clip'),
      ]),
    ).toEqual([{ type: 'clip', tags: ['FIC-101'], paramLow: 30, param: 100 }])
  })

  it('an open-ended range carries only the bound it has', () => {
    expect(toPresetRangeOperations([rule('PI-330', 'min', 2, 'mark')])).toEqual(
      [{ type: 'range_exclude', tags: ['PI-330'], paramLow: 2 }],
    )
  })

  it('a pair with MIXED actions yields two operations with one bound each', () => {
    expect(
      toPresetRangeOperations([
        rule('FIC-101', 'min', 30, 'clip'),
        rule('FIC-101', 'max', 100, 'mark'),
      ]),
    ).toEqual([
      { type: 'clip', tags: ['FIC-101'], paramLow: 30 },
      { type: 'range_exclude', tags: ['FIC-101'], param: 100 },
    ])
  })

  it('a preset rule an earlier build saved with action drop is sent as Exclude', () => {
    expect(
      toPresetRangeOperations([
        rule('TI-204', 'min', 105, 'drop'),
        rule('TI-204', 'max', 120, 'drop'),
      ]),
    ).toEqual([
      { type: 'range_exclude', tags: ['TI-204'], paramLow: 105, param: 120 },
    ])
  })

  it('ignores disabled rules, hand-authored and SD&TA rules, and incomplete ones', () => {
    expect(
      toPresetRangeOperations([
        rule('A', 'min', 1, 'mark', { enabled: false }),
        rule('B', 'min', 1, 'mark', { source: undefined }),
        rule('C', 'min', 1, 'mark', { source: 'sdta' }),
        rule('D', 'min', 1, 'mark', { value: '' }),
        rule('E', 'min', 1, 'mark', { lower: { value: 0, op: '<=' } }),
        rule('F', 'min', 1, 'mark', { op: '>=' }),
        rule('G', 'min', 1, 'drop_row'),
      ]),
    ).toEqual([])
  })

  it('orders by tag then action so the request is stable', () => {
    const ops = toPresetRangeOperations([
      rule('Z', 'min', 1, 'mark'),
      rule('A', 'max', 9, 'mark'),
      rule('A', 'min', 1, 'clip'),
    ])
    expect(ops.map(o => `${o.tags[0]}:${o.type}`)).toEqual([
      'A:clip',
      'A:range_exclude',
      'Z:range_exclude',
    ])
  })
})
