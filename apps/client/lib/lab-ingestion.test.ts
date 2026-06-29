import { describe, it, expect } from 'vitest'
import {
  parseLabCsv,
  alignLabToPredictions,
  type LabPoint,
} from './lab-ingestion'
import type { PredPoint } from './mock-lab-data'

const HOUR = 60 * 60 * 1000

describe('parseLabCsv', () => {
  it('parses rows with a header', () => {
    const { points, errors } = parseLabCsv(
      'timestamp,value\n2026-01-01T00:00:00Z,72.4\n2026-01-01T01:00:00Z,73',
    )
    expect(errors).toEqual([])
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({
      timestamp: '2026-01-01T00:00:00.000Z',
      value: 72.4,
    })
  })

  it('parses headerless rows (2nd column numeric)', () => {
    const { points, errors } = parseLabCsv('2026-01-01T00:00:00Z,50')
    expect(errors).toEqual([])
    expect(points).toHaveLength(1)
    expect(points[0]?.value).toBe(50)
  })

  it('collects bad rows in errors instead of throwing', () => {
    const { points, errors } = parseLabCsv(
      'timestamp,value\nnot-a-date,5\n2026-01-01T00:00:00Z,oops\n2026-01-01T02:00:00Z,9',
    )
    expect(points).toHaveLength(1)
    expect(points[0]?.value).toBe(9)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('Row 2')
    expect(errors[1]).toContain('Row 3')
  })

  it('returns empty result for blank input', () => {
    expect(parseLabCsv('   \n\n')).toEqual({ points: [], errors: [] })
  })
})

describe('alignLabToPredictions', () => {
  const base = Date.parse('2026-01-01T00:00:00.000Z')
  const preds: PredPoint[] = [
    { timestamp: new Date(base).toISOString(), predicted: 10 },
    { timestamp: new Date(base + HOUR).toISOString(), predicted: 12 },
    { timestamp: new Date(base + 2 * HOUR).toISOString(), predicted: 14 },
  ]

  it('aligns a lab point within tolerance to the nearest prediction', () => {
    const labs: LabPoint[] = [
      // 10 min after the 2nd prediction → snaps to it.
      {
        timestamp: new Date(base + HOUR + 10 * 60 * 1000).toISOString(),
        value: 11,
      },
    ]
    const out = alignLabToPredictions(preds, labs, HOUR)
    expect(out).toHaveLength(1)
    expect(out[0]?.predicted).toBe(12)
    expect(out[0]?.actual).toBe(11)
    expect(out[0]?.residual).toBe(1)
  })

  it('drops a lab point outside tolerance', () => {
    const labs: LabPoint[] = [
      { timestamp: new Date(base + 10 * HOUR).toISOString(), value: 99 },
    ]
    expect(alignLabToPredictions(preds, labs, HOUR)).toEqual([])
  })

  it('keeps the closest lab when two snap to the same prediction', () => {
    const labs: LabPoint[] = [
      { timestamp: new Date(base + 20 * 60 * 1000).toISOString(), value: 1 }, // 20m from pred[0]
      { timestamp: new Date(base + 5 * 60 * 1000).toISOString(), value: 2 }, // 5m from pred[0] (closer)
    ]
    const out = alignLabToPredictions(preds, labs, HOUR)
    expect(out).toHaveLength(1)
    expect(out[0]?.actual).toBe(2)
  })

  it('returns empty when either side is empty', () => {
    const oneLab: LabPoint[] = [
      { timestamp: new Date(base).toISOString(), value: 1 },
    ]
    expect(alignLabToPredictions([], oneLab, HOUR)).toEqual([])
    expect(alignLabToPredictions(preds, [], HOUR)).toEqual([])
  })
})
