import { describe, expect, it } from 'vitest'
import {
  interpolateMaxGap,
  preprocessPipelines,
  type Dataset,
} from '@/lib/preprocessing'

type Status = 'Good' | 'Bad'
function series(cells: [number, Status][]): Dataset {
  return {
    tags: ['T'],
    rows: cells.map(([value, status], i) => ({
      timestamp: `2026-01-01 ${String(i).padStart(2, '0')}:00:00`,
      cells: { T: { value, status } },
    })),
  }
}
const run = (cells: [number, Status][], param?: number) =>
  preprocessPipelines(series(cells), {
    T: [{ uid: 'i', category: 'missing', method: 'interpolate', param }],
  }).rows.map(r => r.cells.T)

describe('interpolate max gap (mirrors cleaning_service._max_gap)', () => {
  it('reads the param as whole rows >= 1, else no limit', () => {
    expect(interpolateMaxGap(undefined)).toBeNull()
    expect(interpolateMaxGap(0)).toBeNull()
    expect(interpolateMaxGap(-2)).toBeNull()
    expect(interpolateMaxGap(Number.NaN)).toBeNull()
    expect(interpolateMaxGap(2.9)).toBe(2)
  })

  it('fills a short gap and leaves a longer one untouched', () => {
    const out = run(
      [
        [0, 'Good'],
        [99, 'Bad'],
        [2, 'Good'],
        [99, 'Bad'],
        [99, 'Bad'],
        [99, 'Bad'],
        [6, 'Good'],
      ],
      2,
    )
    expect(out.map(c => c?.status)).toEqual([
      'Good',
      'Good',
      'Good',
      'Bad',
      'Bad',
      'Bad',
      'Good',
    ])
    expect(out[1]?.value).toBe(1)
    expect(out[4]?.value).toBe(99)
  })

  it('a leading run longer than the limit stays missing', () => {
    const out = run(
      [
        [99, 'Bad'],
        [99, 'Bad'],
        [99, 'Bad'],
        [5, 'Good'],
        [99, 'Bad'],
      ],
      2,
    )
    expect(out.map(c => c?.status)).toEqual([
      'Bad',
      'Bad',
      'Bad',
      'Good',
      'Good',
    ])
  })

  it('without a limit behaves exactly as before', () => {
    const cells: [number, Status][] = [
      [0, 'Good'],
      [99, 'Bad'],
      [99, 'Bad'],
      [99, 'Bad'],
      [4, 'Good'],
    ]
    expect(run(cells)).toEqual(run(cells, 0))
    expect(run(cells).map(c => c?.value)).toEqual([0, 1, 2, 3, 4])
  })
})
