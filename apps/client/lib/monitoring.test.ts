import { describe, expect, it } from 'vitest'
import {
  buildMonitoringRows,
  formatLagDuration,
  applyHeldDeviationBand,
  applyHeldValue,
  formatAxisValue,
  heldDeviationStats,
  heldEvalPoints,
  mergeLivePredictions,
  mergeScheduledPredictions,
  residualDensityNote,
  windowStats,
} from './monitoring'
import type { LiveOverlayRow } from '@/lib/monitoring'
import { buildFitRows } from '@/lib/model-metrics'
import { computeMetrics } from '@/lib/model-evaluation'
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

/**
 * MODEL-SERVE-011-T14. The held "Actual" step must be drawn over the FINAL
 * axis, after every prediction series has contributed its timestamps.
 *
 * FOUND ON SCREEN, not in a test: Actual appeared only across 14:13-14:23 —
 * the few minutes three Run Predict live scores happened to occupy — while
 * the hourly predictions sat at 14:00 and 15:00 with no Actual beside them,
 * so there was nothing to compare at the only timestamps that mattered.
 */
describe('applyHeldValue over a widened axis (MODEL-SERVE-011-T14)', () => {
  const at = (iso: string, extra: Record<string, number> = {}) => ({
    t: new Date(iso).getTime(),
    timestamp: iso,
    ...extra,
  })

  it('reaches rows added AFTER the live merge', () => {
    const live = mergeLivePredictions(
      [],
      [{ timestamp: '2026-09-17T07:13:00.000Z', predicted: 110.2 }],
    )
    const widened = mergeScheduledPredictions(live, [
      { windowStart: '2026-09-17T06:00:00.000Z', mean: 110.33 },
    ])

    const out = applyHeldValue(widened, 114)

    // BOTH rows, not just the live one — this is the defect.
    expect(out.map(r => r.held)).toEqual([114, 114])
  })

  it('computes the deviation for an hourly point with no live value', () => {
    const rows = mergeScheduledPredictions(
      [],
      [{ windowStart: '2026-09-17T06:00:00.000Z', mean: 110 }],
    )

    const out = applyHeldValue(rows, 114)

    // `scheduled` is often the ONLY prediction on its row now that the live
    // series is off this chart; reading only live/predict left it blank.
    expect(out[0]!.heldDeviation).toBe(-4)
  })

  it('prefers a real pair over the hourly summary for the deviation', () => {
    const rows = [
      at('2026-09-17T06:00:00.000Z', { predict: 112, scheduled: 110 }),
    ]

    const out = applyHeldValue(rows, 114)

    expect(out[0]!.heldDeviation).toBe(-2)
  })

  it('is idempotent, so running it twice does not compound', () => {
    const rows = [at('2026-09-17T06:00:00.000Z', { scheduled: 110 })]

    const once = applyHeldValue(rows, 114)
    const twice = applyHeldValue(once, 114)

    expect(twice[0]!.heldDeviation).toBe(-4)
    expect(twice[0]!.held).toBe(114)
  })

  it('still draws two endpoints when there is no axis to borrow', () => {
    const out = applyHeldValue([], 114, { fromMs: 1000, toMs: 2000 })

    expect(out.map(r => r.t)).toEqual([1000, 2000])
    expect(out.every(r => r.held === 114)).toBe(true)
  })
})

/**
 * MODEL-SERVE-011-T15. A band drawn from Predict-vs-held-Actual, so the
 * chart has one before any lab sample joins.
 *
 * Every case here guards the same property: this must never be mistaken for,
 * or allowed to overwrite, the REAL residual band.
 */
describe('held-deviation band (MODEL-SERVE-011-T15)', () => {
  const row = (extra: Partial<LiveOverlayRow>): LiveOverlayRow => ({
    t: 1,
    timestamp: '2026-09-17T06:00:00.000Z',
    ...extra,
  })

  it('measures the spread of predicted - held, not of a residual', () => {
    const rows = [
      row({ heldDeviation: -4 }),
      { ...row({ heldDeviation: -2 }), t: 2 },
      { ...row({ heldDeviation: -6 }), t: 3 },
    ]

    const { sd, n } = heldDeviationStats(rows)

    expect(n).toBe(3)
    // population SD of [-4,-2,-6] = sqrt(8/3)
    expect(sd).toBeCloseTo(Math.sqrt(8 / 3), 2)
  })

  it('reports zero spread for a single point rather than inventing one', () => {
    expect(heldDeviationStats([row({ heldDeviation: -4 })])).toEqual({
      sd: 0,
      n: 1,
    })
  })

  it('centres the band on the held value', () => {
    const rows = [row({ held: 114, scheduled: 110 })]

    applyHeldDeviationBand(rows, 2)

    expect(rows[0]!.sd1).toEqual([112, 116])
    expect(rows[0]!.sd2).toEqual([110, 118])
  })

  it('NEVER overwrites a real residual band on a joined row', () => {
    const rows = [row({ held: 114, actual: 100, predict: 101, sd1: [99, 101] })]

    applyHeldDeviationBand(rows, 2)

    // The joined row keeps the band computed from its measured actual.
    expect(rows[0]!.sd1).toEqual([99, 101])
  })

  it('draws nothing when the spread is zero or there is no held value', () => {
    const noSpread = [row({ held: 114 })]
    applyHeldDeviationBand(noSpread, 0)
    expect(noSpread[0]!.sd1).toBeUndefined()

    const noHeld = [row({ scheduled: 110 })]
    applyHeldDeviationBand(noHeld, 2)
    expect(noHeld[0]!.sd1).toBeUndefined()
  })
})

describe('heldDeviationPct (MODEL-SERVE-011-T17)', () => {
  it('expresses the deviation as a share of the held value', () => {
    const rows: LiveOverlayRow[] = [{ t: 1, timestamp: 'x', scheduled: 110 }]

    applyHeldValue(rows, 114)

    expect(rows[0]!.heldDeviation).toBe(-4)
    // -4 / 114 * 100
    expect(rows[0]!.heldDeviationPct).toBeCloseTo(-3.51, 2)
  })

  it('leaves the percentage undefined when the held value is zero', () => {
    const rows: LiveOverlayRow[] = [{ t: 1, timestamp: 'x', scheduled: 5 }]

    applyHeldValue(rows, 0)

    // Undefined, never Infinity — a percentage of nothing is not a number a
    // reader can act on.
    expect(rows[0]!.heldDeviation).toBe(5)
    expect(rows[0]!.heldDeviationPct).toBeUndefined()
  })
})

describe('formatAxisValue (MODEL-SERVE-011-T21)', () => {
  it('prints four significant digits, not four decimals', () => {
    // The raw float this axis used to print, clipped by a 44px gutter.
    expect(formatAxisValue(110.05700050354004)).toBe('110.1')
    // Same four digits at a completely different magnitude — which is why
    // significant digits, not decimals.
    expect(formatAxisValue(0.482137)).toBe('0.4821')
    expect(formatAxisValue(1204.7)).toBe('1205')
  })

  it('keeps trailing zeros so the tick column stays aligned', () => {
    expect(formatAxisValue(110)).toBe('110.0')
    expect(formatAxisValue(-4)).toBe('-4.000')
  })

  it('returns an empty label rather than NaN', () => {
    expect(formatAxisValue(Number.NaN)).toBe('')
    expect(formatAxisValue(Number.POSITIVE_INFINITY)).toBe('')
  })
})

/**
 * MODEL-SERVE-011-T22. The pairs behind the header's Live RMSE before any
 * lab sample has joined.
 */
describe('heldEvalPoints (MODEL-SERVE-011-T22)', () => {
  it('pairs each prediction with the held value as its actual', () => {
    const rows: LiveOverlayRow[] = [
      { t: 1, timestamp: 'a', scheduled: 110, held: 114 },
      { t: 2, timestamp: 'b', scheduled: 112, held: 114 },
    ]

    const points = heldEvalPoints(rows)

    expect(points).toEqual([
      { timestamp: 'a', predicted: 110, actual: 114, residual: -4 },
      { timestamp: 'b', predicted: 112, actual: 114, residual: -2 },
    ])
    // Hand-computed: sqrt(((-4)^2 + (-2)^2) / 2) = sqrt(10)
    // computeMetrics rounds to 2dp by design (lib/model-evaluation.ts), so
    // this asserts the rounded value rather than pretending otherwise.
    expect(computeMetrics(points).rmse).toBe(3.16)
  })

  it('EXCLUDES a row that has a measured actual', () => {
    const rows: LiveOverlayRow[] = [
      { t: 1, timestamp: 'a', predict: 101, actual: 100, held: 114 },
      { t: 2, timestamp: 'b', scheduled: 110, held: 114 },
    ]

    // A measured pair already feeds the REAL pooled metric; pooling it with a
    // carried-forward one would produce a number that is neither.
    expect(heldEvalPoints(rows).map(p => p.timestamp)).toEqual(['b'])
  })

  it('prefers a real pair prediction over the hourly summary', () => {
    const rows: LiveOverlayRow[] = [
      {
        t: 1,
        timestamp: 'a',
        predict: 111,
        scheduled: 110,
        live: 109,
        held: 114,
      },
    ]

    // Same precedence `applyHeldValue` uses for `heldDeviation`, so the
    // deviation on screen and the header figure agree on every row.
    expect(heldEvalPoints(rows)[0]!.predicted).toBe(111)
  })

  it('drops rows missing either side of the pair', () => {
    const rows: LiveOverlayRow[] = [
      { t: 1, timestamp: 'a', scheduled: 110 },
      { t: 2, timestamp: 'b', held: 114 },
      { t: 3, timestamp: 'c' },
    ]

    expect(heldEvalPoints(rows)).toEqual([])
  })
})
