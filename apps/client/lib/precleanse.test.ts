import { describe, expect, it } from 'vitest'
import type { Dataset } from './preprocessing'
import { precleanse, type ConditionalRule } from './precleanse'

function dataset(values: Record<string, (number | null)[]>): Dataset {
  const tags = Object.keys(values)
  const n = Math.max(...tags.map(t => values[t]!.length))
  const rows = Array.from({ length: n }, (_, i) => ({
    timestamp: `2026-01-01T00:0${i}:00Z`,
    cells: Object.fromEntries(
      tags.map(t => {
        const v = values[t]![i]
        return [
          t,
          v === null || v === undefined
            ? { value: 0, status: 'Bad' as const }
            : { value: v, status: 'Good' as const },
        ]
      }),
    ),
  }))
  return { tags, rows }
}

describe('precleanse — conditional rule "drop" action', () => {
  it('removes only the matched tag cell, keeping other tags in the row', () => {
    const ds = dataset({
      mockuppitest_signal_1: [100, 250, 100],
      other_tag: [1, 2, 3],
    })
    const rule: ConditionalRule = {
      id: 'r1',
      tag: 'mockuppitest_signal_1',
      op: '>',
      value: 200,
      action: 'drop',
      enabled: true,
    }
    const out = precleanse(ds, {
      crop: null,
      conditional: [rule],
      statistical: [],
    })

    // Row count must be unchanged — dropping is per-tag, not per-row.
    expect(out.rows).toHaveLength(3)
    // The matched tag's cell at the offending row is gone...
    expect(out.rows[1]!.cells['mockuppitest_signal_1']).toBeUndefined()
    // ...but the OTHER tag's reading at that same timestamp survives.
    expect(out.rows[1]!.cells['other_tag']).toEqual({
      value: 2,
      status: 'Good',
    })
    // Unaffected rows keep the matched tag's value untouched.
    expect(out.rows[0]!.cells['mockuppitest_signal_1']).toEqual({
      value: 100,
      status: 'Good',
    })
  })
})
