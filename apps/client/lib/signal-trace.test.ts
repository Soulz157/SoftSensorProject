import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACE,
  labSamplesBetween,
  pointerPull,
  toPath,
  traceValue,
  valueToY,
} from './signal-trace'

describe('signal trace', () => {
  it('is deterministic for the same seed and position', () => {
    expect(traceValue(123.4)).toBe(traceValue(123.4))
    expect(traceValue(10, { ...DEFAULT_TRACE, seed: 1 })).not.toBe(
      traceValue(10, { ...DEFAULT_TRACE, seed: 2 }),
    )
  })

  it('stays within base ± amplitude', () => {
    for (let p = 0; p < 2000; p += 3.7) {
      const v = traceValue(p)
      expect(Math.abs(v - DEFAULT_TRACE.base)).toBeLessThanOrEqual(
        DEFAULT_TRACE.amplitude,
      )
    }
  })

  it('is continuous (no jumps between close positions)', () => {
    for (let p = 0; p < 500; p += 1) {
      expect(Math.abs(traceValue(p + 0.01) - traceValue(p))).toBeLessThan(0.05)
    }
  })

  it('places lab samples on the interval grid', () => {
    const s = labSamplesBetween(5, 125, 40)
    expect(s.map(x => x.p)).toEqual([40, 80, 120])
  })

  it('pulls toward the pointer, never past the cap, and not from far away', () => {
    expect(pointerPull(100, 50, null)).toBe(0)
    expect(pointerPull(100, 50, { x: 100, y: 400 })).toBe(0)
    const down = pointerPull(100, 50, { x: 100, y: 120 })
    expect(down).toBeGreaterThan(0)
    expect(down).toBeLessThanOrEqual(18)
    expect(pointerPull(100, 50, { x: 100, y: 0 })).toBeLessThan(0)
    const near = pointerPull(100, 50, { x: 110, y: 90 })
    const far = pointerPull(100, 50, { x: 400, y: 90 })
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far))
  })

  it('maps higher values to smaller y (up on screen)', () => {
    expect(valueToY(44, 100)).toBeLessThan(valueToY(41, 100))
  })

  it('builds an SVG path', () => {
    expect(
      toPath([
        { x: 0, y: 1 },
        { x: 2, y: 3 },
      ]),
    ).toBe('M0.0 1.0 L2.0 3.0')
    expect(toPath([])).toBe('')
  })
})
