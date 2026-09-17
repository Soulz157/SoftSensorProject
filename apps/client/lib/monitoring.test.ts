import { describe, expect, it } from 'vitest'
import {
  buildMonitoringRows,
  formatLagDuration,
  residualDensityNote,
  windowStats,
} from './monitoring'
import { buildFitRows } from '@/lib/model-metrics'
import type { EvalPoint } from '@/lib/model-evaluation'

function point(
  timestamp: string,
  actual: number,
  predicted: number,
): EvalPoint {
  return { timestamp, actual, predicted, residual: actual - predicted }
}

// actual and predicted differ everywhere, so a band centered on the wrong
// series is always detectable.
const POINTS: EvalPoint[] = [
  point('2026-01-01T00:00:00.000Z', 10, 8),
  point('2026-01-01T00:01:00.000Z', 20, 17),
  point('2026-01-01T00:02:00.000Z', 30, 34),
]

describe('buildMonitoringRows', () => {
  it('centers the SD bands on actual, not predicted', () => {
    const rows = buildMonitoringRows(POINTS, 2)

    expect(rows[0]?.sd1).toEqual([8, 12]) // 10 ± 2 — NOT 8 ± 2
    expect(rows[1]?.sd1).toEqual([18, 22])
    expect(rows[2]?.sd1).toEqual([28, 32])
  })

  it('widens ±2/±3 SD around the same actual center', () => {
    const [row] = buildMonitoringRows(
      [point('2026-01-01T00:00:00.000Z', 10, 8)],
      2,
    )

    expect(row?.sd1).toEqual([8, 12])
    expect(row?.sd2).toEqual([6, 14])
    expect(row?.sd3).toEqual([4, 16])
  })

  it('leaves the prediction outside the band when the error exceeds the SD', () => {
    const [row] = buildMonitoringRows(
      [point('2026-01-01T00:00:00.000Z', 10, 20)],
      2,
    )
    const [lower, upper] = row?.sd1 ?? [0, 0]

    // Error of 10 with SD 2 — the whole point of anchoring on actual.
    expect(row?.predict).toBe(20)
    expect(upper).toBeLessThan(20)
    expect(lower).toBeLessThan(20)
  })

  it('maps residual, percentage error, and the epoch-ms x value', () => {
    const rows = buildMonitoringRows(POINTS, 1)

    expect(rows[0]?.residual).toBe(2)
    expect(rows[0]?.percentageError).toBe(20)
    expect(rows[2]?.residual).toBe(-4)
    expect(rows[0]?.t).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  it('reports 0% error rather than dividing by a zero actual', () => {
    const rows = buildMonitoringRows(
      [point('2026-01-01T00:00:00.000Z', 0, 5)],
      1,
    )

    expect(rows[0]?.percentageError).toBe(0)
    expect(rows[0]?.residual).toBe(-5)
  })

  it('returns an empty array for no points', () => {
    expect(buildMonitoringRows([], 2)).toEqual([])
  })
})

describe('buildFitRows', () => {
  // The evaluation chart used to render its own `sdActual` band. That field is
  // gone; it now reads the inherited `sd1`. This pins the two to the same
  // values, so a future re-scaling at the call site cannot silently move the
  // evaluation band off the actual line.
  it('inherits the actual-anchored band the evaluation chart renders', () => {
    const rows = buildFitRows(
      [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          actual: 10,
          predicted: 8,
          residual: 2,
        },
      ],
      2,
    )

    expect(rows[0]?.sd1).toEqual([8, 12]) // actual ± sd — the old `sdActual`
    expect(rows[0]?.comparePredict).toBeNull()
  })
})

describe('windowStats', () => {
  it('computes RMSE and the population SD of residuals', () => {
    // Residuals: 2, 3, -4 → mean 1/3.
    const { rmse, sd } = windowStats(POINTS)

    expect(rmse).toBeCloseTo(Math.sqrt((4 + 9 + 16) / 3), 2)
    expect(sd).toBeCloseTo(
      Math.sqrt(((2 - 1 / 3) ** 2 + (3 - 1 / 3) ** 2 + (-4 - 1 / 3) ** 2) / 3),
      2,
    )
  })

  it('is zero for a perfect fit', () => {
    expect(
      windowStats([
        point('2026-01-01T00:00:00.000Z', 10, 10),
        point('2026-01-01T00:01:00.000Z', 20, 20),
      ]),
    ).toEqual({ rmse: 0, sd: 0 })
  })

  it('returns zeros for fewer than two points', () => {
    expect(windowStats([])).toEqual({ rmse: 0, sd: 0 })
    expect(windowStats([point('2026-01-01T00:00:00.000Z', 10, 8)])).toEqual({
      rmse: 0,
      sd: 0,
    })
  })
})

/**
 * MODEL-SERVE-008-T05, the unconditional half. The Residual chart's density
 * is bounded by the lab's reporting rate, not by anything the system can
 * tune — T01 read 3 measured that rate at a 24h median against a 60-minute
 * scoring cadence. The sentence states the limit so an empty or sparse
 * chart cannot read as a gap someone forgot to close.
 */
describe('residualDensityNote (MODEL-SERVE-008-T05)', () => {
  it('states the limit and contrasts it with the scoring cadence when there is a schedule', () => {
    const note = residualDensityNote(60)

    expect(note).toContain('can only ever be as dense as the lab')
    expect(note).toContain('scores every 1h')
    // The REASON the two rates differ, not just the two rates.
    expect(note).toContain('needs a lab measurement to pair with')
  })

  it('still states the limit with no schedule — the physics do not depend on a cadence', () => {
    const note = residualDensityNote(null)

    expect(note).toContain('can only ever be as dense as the lab')
    // No cadence to contrast against, so no invented one.
    expect(note).not.toContain('scores every')
    expect(note.endsWith('.')).toBe(true)
  })

  it('never promises the chart can become denser — the claim this note exists to prevent', () => {
    for (const cadence of [null, 5, 60, 1440]) {
      expect(residualDensityNote(cadence)).not.toMatch(
        /real-?time|live updates|more frequent/i,
      )
    }
  })
})

describe('formatLagDuration', () => {
  it('reads whole hours as hours and anything else as minutes', () => {
    expect(formatLagDuration(1440)).toBe('24h')
    expect(formatLagDuration(60)).toBe('1h')
    expect(formatLagDuration(90)).toBe('90m')
    expect(formatLagDuration(5)).toBe('5m')
  })
})
