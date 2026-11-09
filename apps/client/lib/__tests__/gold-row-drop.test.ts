import { describe, expect, it } from 'vitest'
import {
  estimateGoldRowDrop,
  toChartRows,
  type Cell,
  type Dataset,
} from '@/lib/preprocessing'

const good = (value: number): Cell => ({ value, status: 'Good' })
const bad = (value: number): Cell => ({ value, status: 'Bad' })

/** a, b are features; y is the target. */
function ds(rows: Array<Record<string, Cell>>): Dataset {
  return {
    tags: ['a', 'b', 'y'],
    rows: rows.map((cells, i) => ({
      timestamp: `2026-10-16T00:0${i}:00`,
      cells,
    })),
  }
}

describe('toChartRows', () => {
  const frame = ds([{ a: good(1), b: bad(9), y: good(5) }])

  it('plots every value by default (a raw, as-fetched view)', () => {
    expect(toChartRows(frame)[0]).toMatchObject({ a: 1, b: 9, y: 5 })
  })

  it('turns non-Good readings into gaps with goodOnly (a cleaned view)', () => {
    expect(toChartRows(frame, { goodOnly: true })[0]).toMatchObject({
      a: 1,
      b: null,
      y: 5,
    })
  })
})

describe('estimateGoldRowDrop (mirrors drop_bad_feature_rows)', () => {
  const opts = { tags: ['a', 'b', 'y'], targetTag: 'y' }

  it('drops nothing when every feature reading is Good', () => {
    const r = estimateGoldRowDrop(
      ds([{ a: good(1), b: good(2), y: good(3) }]),
      opts,
    )
    expect(r).toEqual({ total: 1, dropped: 0, kept: 1, byTag: [] })
  })

  it('drops a row when ANY feature is not Good, counted once per row', () => {
    const r = estimateGoldRowDrop(
      ds([
        { a: bad(1), b: bad(2), y: good(3) },
        { a: bad(1), b: good(2), y: good(3) },
        { a: good(1), b: good(2), y: good(3) },
        { a: good(1), b: good(2), y: good(3) },
      ]),
      opts,
    )
    expect(r.dropped).toBe(2)
    expect(r.kept).toBe(2)
    expect(r.byTag).toEqual([
      { tag: 'a', bad: 2, pct: 50 },
      { tag: 'b', bad: 1, pct: 25 },
    ])
  })

  it('never drops for a Bad target (handled at training, not GOLD)', () => {
    const r = estimateGoldRowDrop(
      ds([{ a: good(1), b: good(2), y: bad(3) }]),
      opts,
    )
    expect(r.dropped).toBe(0)
  })

  it('ignores tags that are not saved (deselected in Step 4)', () => {
    const r = estimateGoldRowDrop(ds([{ a: good(1), b: bad(2), y: good(3) }]), {
      tags: ['a', 'y'],
      targetTag: 'y',
    })
    expect(r.dropped).toBe(0)
  })

  it('treats Questionable like Bad — the server keeps Good only', () => {
    const r = estimateGoldRowDrop(
      ds([{ a: { value: 1, status: 'Questionable' }, b: good(2), y: good(3) }]),
      opts,
    )
    expect(r.dropped).toBe(1)
  })

  it('reports every row gone', () => {
    const r = estimateGoldRowDrop(
      ds([
        { a: bad(1), b: good(2), y: good(3) },
        { a: good(1), b: bad(2), y: good(3) },
      ]),
      opts,
    )
    expect(r).toMatchObject({ total: 2, dropped: 2, kept: 0 })
  })
})
