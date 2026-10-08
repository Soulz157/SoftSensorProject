import { describe, it, expect } from 'vitest'
import {
  reconcileRangeUnit,
  describeRangeCutoffSelection,
} from './range-cutoff'
import type { Dataset } from '@/lib/preprocessing'

describe('reconcileRangeUnit', () => {
  it('is dimensionless when the range has no unit, regardless of the tag unit', () => {
    const res = reconcileRangeUnit({ min: 0.85, max: 1.2, unit: null }, 'bar')
    expect(res).toEqual({
      verdict: 'dimensionless',
      applied: { min: 0.85, max: 1.2 },
      factor: null,
      quotedUnit: null,
      tagUnit: 'bar',
    })
  })

  it('is dimensionless even when the tag unit is unknown', () => {
    const res = reconcileRangeUnit({ min: 0.85, max: 1.2, unit: null }, null)
    expect(res.verdict).toBe('dimensionless')
    expect(res.applied).toEqual({ min: 0.85, max: 1.2 })
  })

  it('matches when the quoted unit equals the tag unit', () => {
    const res = reconcileRangeUnit({ min: 105, max: 120, unit: 'C' }, 'C')
    expect(res.verdict).toBe('match')
    expect(res.applied).toEqual({ min: 105, max: 120 })
    expect(res.factor).toBeNull()
  })

  it('matches through a known synonym without treating it as a conversion', () => {
    // "Range control" quotes kg/hr; the tag catalog reports kg/h — same unit,
    // different spelling. Must be `match`, not `converted`.
    const res = reconcileRangeUnit(
      { min: 21500, max: null, unit: 'kg/hr' },
      'kg/h',
    )
    expect(res.verdict).toBe('match')
    expect(res.applied).toEqual({ min: 21500, max: null })
  })

  it('V02: PROVES THE UNIT GATE BITES — converts a known kg/h<->t/h pair and shows both numbers', () => {
    // A tph-quoted range against a kg/h tag: the applied bound must be
    // converted AND both the quoted and applied numbers must be recoverable
    // from the result — never silently applied as the raw number.
    const res = reconcileRangeUnit({ min: 230, max: 300, unit: 'tph' }, 'kg/h')
    expect(res.verdict).toBe('converted')
    expect(res.applied).toEqual({ min: 230_000, max: 300_000 })
    expect(res.factor).toBe(1000)
    expect(res.quotedUnit).toBe('tph')
    expect(res.tagUnit).toBe('kg/h')
  })

  it('converts the inverse direction (kg/h quoted, tag in t/h)', () => {
    const res = reconcileRangeUnit(
      { min: 21500, max: null, unit: 'kg/h' },
      't/h',
    )
    expect(res.verdict).toBe('converted')
    expect(res.applied).toEqual({ min: 21.5, max: null })
    expect(res.factor).toBeCloseTo(1 / 1000)
  })

  it('V02: refuses an unrecognized unit pair rather than applying the raw number', () => {
    // A cP-quoted range against a C tag: no known conversion exists between
    // viscosity and temperature. Must refuse — applied stays null.
    const res = reconcileRangeUnit({ min: 2.5, max: 10, unit: 'cP' }, 'C')
    expect(res.verdict).toBe('unknown-unit')
    expect(res.applied).toBeNull()
    expect(res.factor).toBeNull()
  })

  it('refuses when the tag has no known unit at all (CSV-uploaded / manually inserted tag)', () => {
    const res = reconcileRangeUnit({ min: 105, max: 120, unit: 'C' }, null)
    expect(res.verdict).toBe('tag-unit-unknown')
    expect(res.applied).toBeNull()
  })

  it('is case- and spacing-insensitive when comparing units', () => {
    const res = reconcileRangeUnit({ min: 105, max: 120, unit: '°C' }, 'c')
    expect(res.verdict).toBe('match')
  })
})

function row(
  timestamp: string,
  cells: Record<string, { value: number; status: 'Good' | 'Bad' }>,
): Dataset['rows'][number] {
  return { timestamp, cells }
}

describe('describeRangeCutoffSelection', () => {
  const DATASET: Dataset = {
    tags: ['TI-101', 'LAB.lab'],
    rows: [
      row('t1', {
        'TI-101': { value: 110, status: 'Good' },
        'LAB.lab': { value: 1, status: 'Good' },
      }),
      row('t2', {
        'TI-101': { value: 200, status: 'Good' },
        'LAB.lab': { value: 1, status: 'Good' },
      }), // out of range
      row('t3', {
        'TI-101': { value: 115, status: 'Good' },
        'LAB.lab': { value: 1, status: 'Bad' },
      }), // in range, unlabelled
    ],
  }
  const BOUNDS = [{ tag: 'TI-101', min: 105, max: 120 }]

  it('is silent when no cutoff is enabled', () => {
    const res = describeRangeCutoffSelection({
      dataset: DATASET,
      activeBounds: [],
      targetTag: null,
    })
    expect(res).toEqual({
      refusals: [],
      warnings: [],
      remainingRows: DATASET.rows.length,
      remainingLabelledRows: null,
    })
  })

  it('counts remaining rows after the enabled bound', () => {
    const res = describeRangeCutoffSelection({
      dataset: DATASET,
      activeBounds: BOUNDS,
      targetTag: null,
    })
    expect(res.remainingRows).toBe(2) // t1, t3 — t2 is cut
  })

  it('guard 1: refuses when every row would be cut', () => {
    const res = describeRangeCutoffSelection({
      dataset: DATASET,
      activeBounds: [{ tag: 'TI-101', min: 1000, max: 2000 }],
      targetTag: null,
    })
    expect(res.refusals).toHaveLength(1)
    expect(res.refusals[0]).toMatch(/every row would be marked bad/i)
  })

  it('guard 2: warns that the labelled count cannot be checked before a target is chosen', () => {
    const res = describeRangeCutoffSelection({
      dataset: DATASET,
      activeBounds: BOUNDS,
      targetTag: null,
    })
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/target tag isn't chosen/i)
    expect(res.remainingLabelledRows).toBeNull()
  })

  it('guard 2: counts remaining labelled rows once a target is known, and warns below the floor', () => {
    const res = describeRangeCutoffSelection({
      dataset: DATASET,
      activeBounds: BOUNDS,
      targetTag: 'LAB.lab',
    })
    // t1 survives the cutoff and has a Good label; t3 survives but its label
    // is Bad, so it does not count.
    expect(res.remainingLabelledRows).toBe(1)
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/only 1 labelled row/i)
  })
})
