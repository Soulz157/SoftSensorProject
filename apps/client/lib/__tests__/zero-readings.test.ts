import { describe, expect, it } from 'vitest'
import {
  preprocessPipelines,
  type CleaningStep,
  type Dataset,
} from '@/lib/preprocessing'
import {
  excludesZeros,
  withZerosAsMissing,
  zeroHeavyTags,
  zeroSuggestions,
} from '@/lib/zero-readings'

type Status = 'Good' | 'Bad'
function ds(cols: Record<string, [number, Status][]>): Dataset {
  const tags = Object.keys(cols)
  const n = cols[tags[0]!]!.length
  return {
    tags,
    rows: Array.from({ length: n }, (_, i) => ({
      timestamp: `2026-01-01 ${String(i).padStart(2, '0')}:00:00`,
      cells: Object.fromEntries(
        tags.map(t => [t, { value: cols[t]![i]![0], status: cols[t]![i]![1] }]),
      ),
    })),
  }
}
const good = (vs: number[]): [number, Status][] => vs.map(v => [v, 'Good'])

describe('zeroHeavyTags', () => {
  const data = ds({
    FI: good([0, 0, 5, 6, 7, 8, 9, 10, 11, 12]), // 20% zeros
    TI: good([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), // none
    PI: [[0, 'Bad'], [0, 'Bad'], ...good([1, 2, 3, 4, 5, 6, 7, 8])], // zeros are already Bad
  })

  it('counts exact zeros among Good readings only', () => {
    expect(zeroHeavyTags(data, ['FI', 'TI', 'PI'])).toEqual([
      { tag: 'FI', zeros: 2, readings: 10, share: 0.2 },
    ])
  })

  it('respects the threshold', () => {
    expect(zeroHeavyTags(data, ['FI'], 0.25)).toEqual([])
  })
})

describe('zero suggestion vs the pipeline', () => {
  const data = ds({ FI: good([0, 0, 5, 6]), TI: good([0, 3, 4, 5]) })

  it('drops a tag the pipeline already handles', () => {
    const handled = withZerosAsMissing([], ['FI'], 'z1')
    expect(
      zeroSuggestions(data, ['FI', 'TI'], handled).map(z => z.tag),
    ).toEqual(['TI'])
  })

  it('a windowed or non-zero exclude does not count as handling zeros', () => {
    const windowed: CleaningStep = {
      uid: 'w',
      category: 'outliers',
      method: 'exclude',
      paramLow: 0,
      param: 0,
      startTime: '2026-01-01T00:00',
    }
    const band: CleaningStep = { ...windowed, startTime: undefined, param: 5 }
    expect(excludesZeros(windowed, 'FI')).toBe(false)
    expect(excludesZeros(band, 'FI')).toBe(false)
  })

  it('puts the step first and scoped, so a later fill imputes the zeros', () => {
    const interpolate: CleaningStep = {
      uid: 'i',
      category: 'missing',
      method: 'interpolate',
    }
    const pipeline = withZerosAsMissing([interpolate], ['FI'], 'z1')
    expect(pipeline[0]).toEqual({
      uid: 'z1',
      category: 'outliers',
      method: 'exclude',
      paramLow: 0,
      param: 0,
      tags: ['FI'],
    })
    const out = preprocessPipelines(ds({ FI: good([4, 0, 6]) }), {
      FI: pipeline,
    })
    expect(out.rows.map(r => r.cells.FI)).toEqual([
      { value: 4, status: 'Good' },
      { value: 5, status: 'Good' },
      { value: 6, status: 'Good' },
    ])
  })

  it('adds nothing for an empty tag list', () => {
    expect(withZerosAsMissing([], [], 'z')).toEqual([])
  })
})

describe('zeroSuggestions order', () => {
  it('lists the most zero-heavy tag first', () => {
    const data = ds({
      A: good([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), // 10%
      B: good([0, 0, 0, 3, 4, 5, 6, 7, 8, 9]), // 30%
      C: good([0, 0, 2, 3, 4, 5, 6, 7, 8, 9]), // 20%
    })
    expect(zeroSuggestions(data, ['A', 'B', 'C'], []).map(z => z.tag)).toEqual([
      'B',
      'C',
      'A',
    ])
  })
})
