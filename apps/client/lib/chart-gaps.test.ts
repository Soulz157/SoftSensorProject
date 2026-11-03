import { describe, it, expect } from 'vitest'
import { indexAtOrAfter, sequenceAxis } from './chart-gaps'

const HOUR = 3_600_000
const hours = (...hs: number[]) => hs.map(h => ({ t: h * HOUR }))

describe('sequenceAxis', () => {
  it('numbers the rows and finds no gap in evenly spaced rows', () => {
    const { rows, gaps } = sequenceAxis(hours(0, 1, 2, 3, 4))
    expect(rows.map(r => r.x)).toEqual([0, 1, 2, 3, 4])
    expect(gaps).toEqual([])
  })

  it('finds the one cut-out stretch, with the times on either side', () => {
    const { gaps } = sequenceAxis(hours(0, 1, 2, 3, 100, 101, 102))
    expect(gaps).toEqual([{ index: 4, from: 3 * HOUR, to: 100 * HOUR }])
  })

  it('does not call evenly downsampled rows a gap', () => {
    expect(sequenceAxis(hours(0, 6, 12, 18, 24)).gaps).toEqual([])
  })

  it('tolerates a repeated timestamp without zeroing the cadence', () => {
    const { gaps } = sequenceAxis(hours(0, 1, 1, 2, 3, 50, 51))
    expect(gaps).toEqual([{ index: 5, from: 3 * HOUR, to: 50 * HOUR }])
  })

  it('has no cadence to judge with fewer than three rows or no positive step', () => {
    expect(sequenceAxis(hours(0, 100)).gaps).toEqual([])
    expect(sequenceAxis(hours(5, 5, 5)).gaps).toEqual([])
  })
})

describe('indexAtOrAfter', () => {
  const rows = hours(0, 1, 2, 10, 11)
  it('lands a cut on the first row at or after it', () => {
    expect(indexAtOrAfter(rows, 2 * HOUR)).toBe(2)
    expect(indexAtOrAfter(rows, 5 * HOUR)).toBe(3)
  })
  it('clamps a cut past the end to the last row', () => {
    expect(indexAtOrAfter(rows, 99 * HOUR)).toBe(4)
  })
})
