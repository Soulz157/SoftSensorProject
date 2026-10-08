import { describe, expect, it } from 'vitest'
import {
  EMPTY_PRECLEANSE_CONFIG,
  matchesConditionalRule,
  precleanse,
  type ConditionalRule,
} from '@/lib/precleanse'
import type { Dataset } from '@/lib/preprocessing'

/** DS-LAKE-032-T10 / D09 — the two-operator conditional rule,
 * `low <op> TAG <op> high`. */

const range = (
  low: number | '',
  lowOp: '<' | '<=',
  op: '<' | '<=',
  high: number | '',
) => ({ lower: { value: low, op: lowOp }, op, value: high })

describe('matchesConditionalRule', () => {
  it('200 <= TAG < 500 includes 200 and excludes 500', () => {
    const r = range(200, '<=', '<', 500)
    expect(matchesConditionalRule(199.9, r)).toBe(false)
    expect(matchesConditionalRule(200, r)).toBe(true)
    expect(matchesConditionalRule(499.9, r)).toBe(true)
    expect(matchesConditionalRule(500, r)).toBe(false)
  })

  it('200 < TAG <= 500 flips both ends', () => {
    const r = range(200, '<', '<=', 500)
    expect(matchesConditionalRule(200, r)).toBe(false)
    expect(matchesConditionalRule(500, r)).toBe(true)
  })

  it('an incomplete lower bound matches nothing', () => {
    expect(matchesConditionalRule(300, range('', '<=', '<', 500))).toBe(false)
  })

  it('a rule without `lower` is the single comparison it always was', () => {
    expect(matchesConditionalRule(600, { op: '>', value: 500 })).toBe(true)
    expect(matchesConditionalRule(400, { op: '>', value: 500 })).toBe(false)
    expect(matchesConditionalRule(400, { op: '>', value: '' })).toBe(false)
  })
})

describe('precleanse with a range rule', () => {
  const ds: Dataset = {
    tags: ['T'],
    rows: [100, 200, 350, 500, 700].map((value, i) => ({
      timestamp: `2026-01-01 0${i}:00:00`,
      cells: { T: { value, status: 'Good' as const } },
    })),
  }
  const rule = (extra: Partial<ConditionalRule>): ConditionalRule => ({
    id: 'r',
    tag: 'T',
    op: '<',
    value: 500,
    action: 'drop_row',
    enabled: true,
    lower: { value: 200, op: '<=' },
    ...extra,
  })

  it('drops only rows inside the interval', () => {
    const out = precleanse(ds, {
      ...EMPTY_PRECLEANSE_CONFIG,
      conditional: [rule({})],
    })
    expect(out.rows.map(r => r.cells.T!.value)).toEqual([100, 500, 700])
  })

  it('skips a rule whose lower bound is still empty', () => {
    const out = precleanse(ds, {
      ...EMPTY_PRECLEANSE_CONFIG,
      conditional: [rule({ lower: { value: '', op: '<=' } })],
    })
    expect(out.rows).toHaveLength(5)
  })
})
