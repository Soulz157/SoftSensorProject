import { describe, expect, it } from 'vitest'
import {
  buildMonitoringRows,
  formatLagDuration,
  mergeLivePredictions,
  mergeScheduledPredictions,
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

/**
 * MODEL-SERVE-008-T04. Two series, two provenances, one chart — never one
 * series with holes in it, and never an `actual` invented to fill a dense
 * predicted point's row.
 */
describe('mergeLivePredictions (MODEL-SERVE-008-T04)', () => {
  // `sd` is required — the SD band is part of what a joined row carries,
  // and a fixture that omits it type-checks as a lie even while vitest runs
  // it happily.
  const joined = buildMonitoringRows(
    [
      point('2026-09-17T00:00:00.000Z', 40, 39),
      point('2026-09-17T02:00:00.000Z', 42, 41),
    ],
    1,
  )

  it('keeps the dense series under its OWN key, never merged into predict', () => {
    const out = mergeLivePredictions(joined, [
      { timestamp: '2026-09-17T00:00:00.000Z', predicted: 39.5 },
    ])

    const row = out.find(r => r.timestamp === '2026-09-17T00:00:00.000Z')!
    expect(row.live).toBe(39.5)
    // The window plane's own prediction is untouched — two provenances.
    expect(row.predict).toBe(39)
  })

  it('NEVER invents an actual for a dense-only timestamp', () => {
    const out = mergeLivePredictions(joined, [
      { timestamp: '2026-09-17T01:00:00.000Z', predicted: 40.5 },
    ])

    const denseOnly = out.find(r => r.timestamp === '2026-09-17T01:00:00.000Z')!
    expect(denseOnly.live).toBe(40.5)
    // The whole point: no fabricated ground truth, and no residual either.
    expect(denseOnly.actual).toBeUndefined()
    expect(denseOnly.residual).toBeUndefined()
  })

  it('interleaves dense points between sparse pairs, in time order', () => {
    const out = mergeLivePredictions(joined, [
      { timestamp: '2026-09-17T00:30:00.000Z', predicted: 1 },
      { timestamp: '2026-09-17T01:30:00.000Z', predicted: 2 },
    ])

    expect(out.map(r => r.timestamp)).toEqual([
      '2026-09-17T00:00:00.000Z',
      '2026-09-17T00:30:00.000Z',
      '2026-09-17T01:30:00.000Z',
      '2026-09-17T02:00:00.000Z',
    ])
  })

  it('does not snap a dense point onto a nearby pair — exact timestamps only', () => {
    const out = mergeLivePredictions(joined, [
      // One minute off a joined row. Snapping it would attach a prediction
      // to a pair it did not come from.
      { timestamp: '2026-09-17T00:01:00.000Z', predicted: 39.9 },
    ])

    const pair = out.find(r => r.timestamp === '2026-09-17T00:00:00.000Z')!
    expect(pair.live).toBeUndefined()
    expect(out).toHaveLength(3)
  })

  it('returns the joined rows unchanged when there is no dense series at all', () => {
    const out = mergeLivePredictions(joined, [])

    expect(out).toHaveLength(2)
    expect(out.every(r => r.live === undefined)).toBe(true)
  })

  it('survives an unparseable dense timestamp rather than placing it at NaN', () => {
    const out = mergeLivePredictions(joined, [
      { timestamp: 'not-a-date', predicted: 5 },
    ])

    expect(out).toHaveLength(2)
  })
})

/**
 * MODEL-SERVE-009-T05. The target IS fetched every window, but PI holds a
 * sparse `.lab` value between samples — measured live: zero real lab events
 * across every joined window. So the held number is rendered as "Actual"
 * (operator decision) while staying OUT of `actual`, which is what the
 * residual and the SD band read.
 */
describe('held target series (MODEL-SERVE-009-T05)', () => {
  const joined = buildMonitoringRows(
    [
      point('2026-09-17T00:00:00.000Z', 40, 39),
      point('2026-09-17T02:00:00.000Z', 42, 41),
    ],
    1,
  )

  it('applies the held value across every point on the axis', () => {
    const out = mergeLivePredictions(joined, [], 41.5)

    expect(out.every(r => r.held === 41.5)).toBe(true)
  })

  it('NEVER writes the held value into `actual` — the residual must not see it', () => {
    const out = mergeLivePredictions(joined, [], 999)

    // `actual` stays the genuinely measured pair. A held number here would
    // publish a confident residual against a value nobody measured.
    expect(out[0]!.actual).toBe(40)
    expect(out[1]!.actual).toBe(42)
    expect(out[0]!.residual).toBe(40 - 39)
  })

  it('omits the series entirely when the lab has never reported', () => {
    const out = mergeLivePredictions(joined, [], null)

    expect(out.every(r => r.held === undefined)).toBe(true)
  })

  it('borrows the prediction axis rather than inventing its own timestamps', () => {
    // One dense prediction between the two pairs: the held line should
    // appear on it too, because it is one carried-forward reading — not a
    // measurement that happened at that moment.
    const out = mergeLivePredictions(
      joined,
      [{ timestamp: '2026-09-17T01:00:00.000Z', predicted: 40.5 }],
      41.5,
    )

    expect(out).toHaveLength(3)
    expect(out.map(r => r.held)).toEqual([41.5, 41.5, 41.5])
    // And that middle row still has no actual invented for it.
    expect(out[1]!.actual).toBeUndefined()
  })
})

describe('held-only series gets an axis (MODEL-SERVE-009-T05)', () => {
  const BOUNDS = {
    fromMs: Date.parse('2026-09-17T00:00:00.000Z'),
    toMs: Date.parse('2026-09-18T00:00:00.000Z'),
  }

  it('draws the held value across the visible range when nothing else exists', () => {
    // No joined pairs and no dense predictions — the exact state that made
    // the chart render "no lab measurement has arrived" while a known lab
    // value sat unused.
    const out = mergeLivePredictions([], [], 196, BOUNDS)

    expect(out).toHaveLength(2)
    expect(out.map(r => r.held)).toEqual([196, 196])
    expect(out[0]!.t).toBe(BOUNDS.fromMs)
    expect(out[1]!.t).toBe(BOUNDS.toMs)
  })

  it('invents NO actual and NO predict for those endpoints', () => {
    const out = mergeLivePredictions([], [], 196, BOUNDS)

    // Only the constant is drawn. A fabricated actual here is exactly what
    // the Count probe exists to prevent.
    expect(out.every(r => r.actual === undefined)).toBe(true)
    expect(out.every(r => r.predict === undefined)).toBe(true)
    expect(out.every(r => r.live === undefined)).toBe(true)
  })

  it('prefers a real axis when one exists, rather than the synthetic endpoints', () => {
    const out = mergeLivePredictions(
      [],
      [{ timestamp: '2026-09-17T03:00:00.000Z', predicted: 40 }],
      196,
      BOUNDS,
    )

    expect(out).toHaveLength(1)
    expect(out[0]!.live).toBe(40)
    expect(out[0]!.held).toBe(196)
  })

  it('stays empty with no held value and nothing to draw', () => {
    expect(mergeLivePredictions([], [], null, BOUNDS)).toEqual([])
  })
})

/**
 * MODEL-SERVE-009-T05 follow-up. `live - held` is DEVIATION FROM THE LAST
 * MEASURED LAB VALUE, not a residual: the number it subtracts was measured
 * the last time the lab reported, not in this interval. It is drawn so the
 * Residual card stays informative while the lab is quiet, and kept out of
 * everything that assumes a measured actual per point.
 */
describe('held deviation is not a residual (MODEL-SERVE-009-T05)', () => {
  const BOUNDS = {
    fromMs: Date.parse('2026-09-17T00:00:00.000Z'),
    toMs: Date.parse('2026-09-18T00:00:00.000Z'),
  }

  it('computes prediction minus the last measured lab value', () => {
    const out = mergeLivePredictions(
      [],
      [{ timestamp: '2026-09-17T03:00:00.000Z', predicted: 206.9 }],
      196,
      BOUNDS,
    )

    expect(out[0]!.heldDeviation).toBeCloseTo(10.9, 10)
  })

  it('NEVER writes it into `residual` — the SD band and RMSE read that key', () => {
    const out = mergeLivePredictions(
      [],
      [{ timestamp: '2026-09-17T03:00:00.000Z', predicted: 206.9 }],
      196,
      BOUNDS,
    )

    expect(out[0]!.residual).toBeUndefined()
    expect(out[0]!.actual).toBeUndefined()
  })

  it('leaves a genuinely measured residual untouched when a pair exists', () => {
    const joined = buildMonitoringRows(
      [point('2026-09-17T00:00:00.000Z', 40, 39)],
      1,
    )

    const out = mergeLivePredictions(joined, [], 196, BOUNDS)

    // The real residual survives, and the deviation is computed from the
    // window-plane prediction on that same row — two different quantities
    // under two different keys, never merged.
    expect(out[0]!.residual).toBe(1)
    expect(out[0]!.heldDeviation).toBeCloseTo(39 - 196, 10)
  })

  it('computes no deviation for a row with no prediction at all', () => {
    // Held value present, nothing predicted: there is nothing to deviate.
    const out = mergeLivePredictions([], [], 196, BOUNDS)

    expect(out.every(r => r.heldDeviation === undefined)).toBe(true)
  })
})

/**
 * MODEL-SERVE-011-T12. The scheduled plane's hourly points, folded onto the
 * axis the other two prediction series already produced.
 */
describe('mergeScheduledPredictions (MODEL-SERVE-011-T12)', () => {
  const at = (iso: string, extra: Record<string, number> = {}) => ({
    t: new Date(iso).getTime(),
    timestamp: iso,
    ...extra,
  })

  it('attaches a window summary to an existing row at the SAME instant', () => {
    const rows = [at('2026-09-17T05:00:00.000Z', { live: 110.1 })]
    const merged = mergeScheduledPredictions(rows, [
      { windowStart: '2026-09-17T05:00:00.000Z', mean: 110.11 },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]!.scheduled).toBe(110.11)
    // Its own key — an hour's mean is not the live instant it landed beside.
    expect(merged[0]!.live).toBe(110.1)
  })

  it('never snaps a window summary onto a nearby row', () => {
    const rows = [at('2026-09-17T05:00:00.000Z', { live: 110.1 })]
    const merged = mergeScheduledPredictions(rows, [
      { windowStart: '2026-09-17T06:00:00.000Z', mean: 110.33 },
    ])

    // Two rows, not one enriched row: attaching an hour's mean to a reading
    // it did not come from is the same fabrication the pair join refuses.
    expect(merged).toHaveLength(2)
    expect(merged[0]!.scheduled).toBeUndefined()
    expect(merged[1]!.scheduled).toBe(110.33)
  })

  it('keeps the axis sorted when a window predates every existing row', () => {
    const rows = [at('2026-09-17T06:00:00.000Z', { live: 110.3 })]
    const merged = mergeScheduledPredictions(rows, [
      { windowStart: '2026-09-17T05:00:00.000Z', mean: 110.11 },
    ])

    expect(merged.map(r => r.timestamp)).toEqual([
      '2026-09-17T05:00:00.000Z',
      '2026-09-17T06:00:00.000Z',
    ])
  })

  it('returns the rows untouched when there is nothing scheduled', () => {
    const rows = [at('2026-09-17T05:00:00.000Z', { live: 110.1 })]
    expect(mergeScheduledPredictions(rows, [])).toBe(rows)
  })

  it('skips an unparseable windowStart rather than plotting NaN', () => {
    const rows = [at('2026-09-17T05:00:00.000Z')]
    const merged = mergeScheduledPredictions(rows, [
      { windowStart: 'not-a-date', mean: 1 },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]!.scheduled).toBeUndefined()
  })
})
