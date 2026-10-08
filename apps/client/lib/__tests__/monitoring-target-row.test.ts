import { describe, it, expect } from 'vitest'
import {
  explainTargetPsi,
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

describe('target tooltips', () => {
  it('psi: target wording at CRITICAL, never "this input" or "predicting on data"', () => {
    const out = explainTargetPsi(
      { psi: 0.4, status: 'CRITICAL', liveTotal: 100, bins: null },
      { warn: 0.1, critical: 0.25, minSamplesPerBin: 20, outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20 },
    )
    expect(out.meaning).toMatch(/^The target’s live distribution/)
    expect(out.meaning).not.toMatch(/this input|predicting on data/i)
    expect(out.meaning).toContain(TARGET_NOT_COUNTED_NOTE)
    expect(out.criteria).toEqual(['PSI 0.400 ≥ 0.25 → CRITICAL'])
  })

  it('psi: target wording for every status, including OK', () => {
    const out = explainTargetPsi(
      { psi: 0.01, status: 'OK', liveTotal: 100, bins: null },
      { warn: 0.1, critical: 0.25, minSamplesPerBin: 20, outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20 },
    )
    expect(out.meaning).toMatch(/^The target’s live distribution/)
    expect(out.meaning).not.toMatch(/this input/i)
    expect(out.meaning).toContain(TARGET_NOT_COUNTED_NOTE)
  })
})
