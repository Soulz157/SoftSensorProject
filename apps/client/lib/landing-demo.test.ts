import { describe, expect, it } from 'vitest'
import {
  DEMO_TAGS,
  psiStatusOf,
  signed,
  sparkPoints,
  tagHistory,
  tagValueAt,
} from './landing-demo'

describe('landing demo data', () => {
  it('grades PSI with the app cutoffs, >= at each', () => {
    expect(psiStatusOf(0.0999)).toBe('OK')
    expect(psiStatusOf(0.1)).toBe('WARN')
    expect(psiStatusOf(0.2499)).toBe('WARN')
    expect(psiStatusOf(0.25)).toBe('CRITICAL')
  })

  it('demo shows one drifting input and the rest stable', () => {
    const statuses = DEMO_TAGS.map(t => psiStatusOf(t.psi))
    expect(statuses.filter(s => s === 'WARN')).toHaveLength(1)
    expect(statuses.filter(s => s === 'OK')).toHaveLength(3)
  })

  it('tag values are deterministic and stay within base ± amplitude', () => {
    for (const t of DEMO_TAGS) {
      expect(tagValueAt(t, 5)).toBe(tagValueAt(t, 5))
      for (let s = 0; s < 300; s++) {
        expect(Math.abs(tagValueAt(t, s) - t.shape.base)).toBeLessThanOrEqual(
          t.shape.amplitude,
        )
      }
    }
  })

  it('history ends at the current value, oldest first', () => {
    const t = DEMO_TAGS[0]!
    const h = tagHistory(t, 50, 10)
    expect(h).toHaveLength(10)
    expect(h[9]).toBe(tagValueAt(t, 50))
    expect(h[0]).toBe(tagValueAt(t, 41))
  })

  it('scales sparkline points into the box, min at the bottom', () => {
    expect(sparkPoints([1, 3, 2], 20, 10)).toBe('0.0,10.0 10.0,0.0 20.0,5.0')
    expect(sparkPoints([], 20, 10)).toBe('')
    expect(sparkPoints([4, 4], 10, 6)).toBe('0.0,6.0 10.0,6.0')
  })

  it('always shows the sign', () => {
    expect(signed(0.24)).toBe('+0.2')
    expect(signed(-0.31)).toBe('-0.3')
  })
})
