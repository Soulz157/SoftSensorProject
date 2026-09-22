import { describe, it, expect } from 'vitest'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'
import {
  downsampleRows,
  previewRowLimit,
  CHART_MAX_POINTS,
  PREVIEW_MAX_ROWS,
} from '@/lib/downsample'

describe('previewRowLimit', () => {
  it('gives the full ceiling to a narrow dataset — including the widest real one (22 tags)', () => {
    expect(previewRowLimit(1)).toBe(PREVIEW_MAX_ROWS)
    expect(previewRowLimit(22)).toBe(PREVIEW_MAX_ROWS)
    expect(previewRowLimit(25)).toBe(PREVIEW_MAX_ROWS)
    expect(previewRowLimit(0)).toBe(PREVIEW_MAX_ROWS)
  })

  it('shrinks with width so rows × tags stays inside the budget', () => {
    expect(previewRowLimit(50)).toBe(5_000)
    expect(previewRowLimit(100)).toBe(2_500)
    for (const tags of [30, 50, 100, 200]) {
      expect(previewRowLimit(tags) * tags).toBeLessThanOrEqual(250_000)
    }
  })

  it('never drops below the 1,000 rows the preview always had', () => {
    expect(previewRowLimit(400)).toBe(1_000)
    expect(previewRowLimit(8_000)).toBe(1_000)
  })
})

function series(
  n: number,
  value: (i: number) => Record<string, number | null>,
): SensorChartRow[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: `2026-03-01 00:${String(i).padStart(6, '0')}`,
    ...value(i),
  }))
}

describe('downsampleRows', () => {
  it('returns the input untouched when it already fits', () => {
    const rows = series(500, i => ({ A: i }))
    const out = downsampleRows(rows, ['A'], CHART_MAX_POINTS)
    expect(out.downsampled).toBe(false)
    expect(out.rows).toBe(rows)
    expect(out.sourceCount).toBe(500)
  })

  it('cuts to at most maxPoints and reports the source count', () => {
    const rows = series(10_000, i => ({ A: Math.sin(i / 50), B: i % 97 }))
    const out = downsampleRows(rows, ['A', 'B'], 1_000)
    expect(out.downsampled).toBe(true)
    expect(out.rows.length).toBeLessThanOrEqual(1_000)
    expect(out.rows.length).toBeGreaterThan(100)
    expect(out.sourceCount).toBe(10_000)
  })

  it('keeps the first and last rows and stays chronological', () => {
    const rows = series(10_000, i => ({ A: Math.sin(i / 30) }))
    const out = downsampleRows(rows, ['A'], 800)
    expect(out.rows[0]).toBe(rows[0])
    expect(out.rows[out.rows.length - 1]).toBe(rows[rows.length - 1])
    const stamps = out.rows.map(r => r.timestamp)
    expect(stamps).toEqual([...stamps].sort())
  })

  it('keeps a lone spike that striding would drop', () => {
    const rows = series(10_000, i => ({ A: i === 4_321 ? 1_000 : 1 }))
    const out = downsampleRows(rows, ['A'], 500)
    expect(out.rows).toContain(rows[4_321])
  })

  it('keeps a lone dip', () => {
    const rows = series(10_000, i => ({ A: i === 7_777 ? -1_000 : 1 }))
    const out = downsampleRows(rows, ['A'], 500)
    expect(out.rows).toContain(rows[7_777])
  })

  it('normalises per tag so a large-unit tag does not decide every bucket', () => {
    // B ramps through thousands of units, A moves by a fraction. On raw
    // values B would win every bucket; normalised, A's single spike (its own
    // maximum) outranks B's mid-range reading there and must survive.
    const rows = series(10_000, i => ({
      A: i === 2_500 ? 0.9 : 0.1,
      B: i * 0.5,
    }))
    const out = downsampleRows(rows, ['A', 'B'], 600)
    expect(out.rows).toContain(rows[2_500])
  })

  it('tolerates missing values and no tags', () => {
    const rows = series(3_000, i => ({ A: i % 3 === 0 ? null : i }))
    expect(() => downsampleRows(rows, ['A', 'Missing'], 400)).not.toThrow()
    const flat = downsampleRows(rows, [], 400)
    expect(flat.downsampled).toBe(true)
    expect(flat.rows.length).toBeLessThanOrEqual(400)
  })
})
