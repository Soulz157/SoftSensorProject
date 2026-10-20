import { describe, it, expect } from 'vitest'
import {
  explainTargetRange,
  TARGET_NOT_COUNTED_NOTE,
  unrecordedTargetColumn,
  withTargetFirst,
} from '../monitoring-target-row'

describe('withTargetFirst (MODEL-SERVE-018)', () => {
  it('pins the target first and flags only it', () => {
    expect(withTargetFirst(['a', 'b'], 'y')).toEqual([
      { row: 'y', isTarget: true },
      { row: 'a', isTarget: false },
      { row: 'b', isTarget: false },
    ])
  })

  it('returns the features alone when there is no target', () => {
    expect(withTargetFirst(['a'], null)).toEqual([
      { row: 'a', isTarget: false },
    ])
    expect(withTargetFirst(['a'], undefined)).toEqual([
      { row: 'a', isTarget: false },
    ])
  })
})

describe('unrecordedTargetColumn', () => {
  it('names the target only when it is known but has no verdict', () => {
    expect(unrecordedTargetColumn({ targetColumn: 'Y', target: null })).toBe(
      'Y',
    )
    expect(unrecordedTargetColumn({ targetColumn: null, target: null })).toBe(
      null,
    )
    expect(unrecordedTargetColumn({})).toBe(null)
  })
})

describe('target tooltips (MODEL-SERVE-036)', () => {
  const T = { outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20, minSamples: 30 }
  const col = (status: 'OK' | 'CRITICAL', above: number) => ({
    column: 'Y',
    liveTotal: 100,
    below: 0,
    above,
    outOfRangePct: above,
    trainMin: 0,
    trainMax: 10,
    binMode: 'continuous' as const,
    status,
    bins: null,
  })

  it('target wording at CRITICAL, never "this input" or "extrapolating"', () => {
    const out = explainTargetRange(col('CRITICAL', 40), T)
    expect(out.meaning).toMatch(/^Many live target values/)
    expect(out.meaning).not.toMatch(/this input|extrapolating/i)
    expect(out.meaning).toContain(TARGET_NOT_COUNTED_NOTE)
    expect(out.criteria[1]).toMatch(/≥ 20% → CRITICAL$/)
  })

  it('target wording for every status, including OK', () => {
    const out = explainTargetRange(col('OK', 0), T)
    expect(out.meaning).toMatch(/^Live target values stay inside/)
    expect(out.meaning).toContain(TARGET_NOT_COUNTED_NOTE)
  })
})
