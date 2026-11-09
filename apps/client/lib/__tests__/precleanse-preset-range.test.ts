import { describe, expect, it } from 'vitest'
import {
  precleanse,
  precleanseBreakdown,
  type ConditionalRule,
} from '@/lib/precleanse'
import type { Dataset } from '@/lib/preprocessing'
import { preprocessPipelines } from '@/lib/preprocessing'

const DATA: Dataset = {
  tags: ['T', 'U'],
  rows: [5, 50, 150].map((v, i) => ({
    timestamp: `2026-01-01T00:0${i}:00Z`,
    cells: {
      T: { value: v, status: 'Good' as const },
      U: { value: 7, status: 'Good' as const },
    },
  })),
}

function pair(
  action: ConditionalRule['action'],
  // 'hand' = a rule typed in the Conditional tab (no `source`).
  origin: 'preset-range' | 'hand' = 'preset-range',
): ConditionalRule[] {
  const source = origin === 'hand' ? undefined : origin
  return [
    {
      id: 'min',
      tag: 'T',
      op: '<',
      value: 10,
      action,
      enabled: true,
      source,
    },
    {
      id: 'max',
      tag: 'T',
      op: '>',
      value: 100,
      action,
      enabled: true,
      source,
    },
  ]
}

const run = (conditional: ConditionalRule[]) =>
  precleanse(DATA, { crop: null, conditional, statistical: [] })

describe('preset-range conditional rules (DS-LAKE-038)', () => {
  it('clip clamps to the bound and leaves status and rows alone', () => {
    const out = run(pair('clip'))
    expect(out.rows.map(r => r.cells.T?.value)).toEqual([10, 50, 100])
    expect(out.rows.map(r => r.cells.T?.status)).toEqual([
      'Good',
      'Good',
      'Good',
    ])
    expect(out.rows).toHaveLength(3)
  })

  it('Exclude marks out-of-range readings Bad and KEEPS their value, like the toolkit', () => {
    const out = run(pair('mark'))
    expect(out.rows.map(r => r.cells.T)).toEqual([
      { value: 5, status: 'Bad' },
      { value: 50, status: 'Good' },
      { value: 150, status: 'Bad' },
    ])
    // Other tags in those rows survive untouched, and no row is removed.
    expect(out.rows.map(r => r.cells.U?.value)).toEqual([7, 7, 7])
    expect(out.rows).toHaveLength(3)
  })

  it('an excluded reading is imputable by a later fill step', () => {
    const out = preprocessPipelines(run(pair('mark')), {
      T: [{ uid: 's', category: 'missing', method: 'interpolate' }],
    })
    expect(out.rows.map(r => r.cells.T?.status)).toEqual([
      'Good',
      'Good',
      'Good',
    ])
    expect(out.rows[0]?.cells.T?.value).toBe(50)
  })

  it('a preset rule an earlier build saved as drop is treated as Exclude, not a hole', () => {
    expect(run(pair('drop')).rows.map(r => r.cells.T)).toEqual(
      run(pair('mark')).rows.map(r => r.cells.T),
    )
  })

  it('a hand-written condition saved with drop is Exclude as well, not a deleted cell', () => {
    expect(run(pair('drop', 'hand')).rows.map(r => r.cells.T)).toEqual(
      run(pair('mark')).rows.map(r => r.cells.T),
    )
  })

  it('a hand-written one-sided condition can Clip to its own value', () => {
    const out = run(pair('clip', 'hand'))
    expect(out.rows.map(r => r.cells.T?.value)).toEqual([10, 50, 100])
    expect(out.rows.map(r => r.cells.T?.status)).toEqual([
      'Good',
      'Good',
      'Good',
    ])
  })

  it('a clip is not counted as a removal in the breakdown; an exclude is', () => {
    const cfg = { crop: null, statistical: [] }
    const clip = precleanseBreakdown(DATA, {
      ...cfg,
      conditional: pair('clip'),
    })
    const exclude = precleanseBreakdown(DATA, {
      ...cfg,
      conditional: pair('mark'),
    })
    expect(clip.removed.conditional).toBe(0)
    expect(exclude.removed.conditional).toBe(2)
  })

  it('a value exactly on a bound is untouched by either action', () => {
    const edge: Dataset = {
      tags: ['T'],
      rows: [10, 100].map((v, i) => ({
        timestamp: `2026-01-01T00:0${i}:00Z`,
        cells: { T: { value: v, status: 'Good' as const } },
      })),
    }
    for (const action of ['clip', 'mark'] as const) {
      const out = precleanse(edge, {
        crop: null,
        conditional: pair(action),
        statistical: [],
      })
      expect(out.rows.map(r => r.cells.T)).toEqual([
        { value: 10, status: 'Good' },
        { value: 100, status: 'Good' },
      ])
    }
  })

  it('an excluded reading keeps its value, so a later crop judges the real number', () => {
    const cropped = preprocessPipelines(run(pair('mark')), {
      T: [
        {
          uid: 'c',
          category: 'outliers',
          method: 'crop',
          paramLow: 1,
          param: 1000,
        },
      ],
    })
    // 5 and 150 are Bad but still 5 and 150 - both inside the crop band, so
    // every row survives (a zeroed hole would have fallen below the floor).
    expect(cropped.rows.map(r => r.cells.T?.value)).toEqual([5, 50, 150])
  })
})
