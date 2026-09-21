import { describe, expect, it } from 'vitest'
import { formatMetricValue } from '@/lib/model-evaluation'

/**
 * The shared metric readout used by Models/[id]'s header (the serving
 * version's RMSE/R²) and the retrain result card. One formatter, so two
 * screens cannot print the same number two ways.
 */
describe('formatMetricValue', () => {
  it('prints four decimals, keeping trailing zeros so a column lines up', () => {
    expect(formatMetricValue(0.5)).toBe('0.5000')
    expect(formatMetricValue(1.23456)).toBe('1.2346')
    expect(formatMetricValue(1204)).toBe('1204.0000')
  })

  it('renders a negative R² as the real number — never clamped', () => {
    // A real run on this system scored r2 = -1,110,858 (MODEL-FLOW-004).
    expect(formatMetricValue(-1110858)).toBe('-1110858.0000')
  })

  it('never renders a missing figure as 0 — that is a different fact', () => {
    expect(formatMetricValue(null)).toBe('not recorded')
    expect(formatMetricValue(undefined)).toBe('not recorded')
    expect(formatMetricValue(0)).toBe('0.0000')
  })

  it('refuses a non-finite number rather than printing NaN/Infinity', () => {
    expect(formatMetricValue(Number.NaN)).toBe('not recorded')
    expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe('not recorded')
  })
})
