import { describe, it, expect } from 'vitest'
import { buildRetrainSeries } from './retrain-series'
import type { RunPredictions } from '@/services/model-draft'

function series(
  points: { timestamp: string; yTrue: number; yPred: number }[],
  residualSd = 0.5,
): RunPredictions {
  return {
    sourceKey: 'k',
    rowCount: points.length,
    residualSd,
    residualRmseCheck: residualSd,
    yTrueMin: 0,
    yTrueMax: 0,
    yPredMin: 0,
    yPredMax: 0,
    points,
    derivedFromTarget: null,
    targetScaled: false,
  }
}

const T = (h: number) => `2026-01-01 ${String(h).padStart(2, '0')}:00:00`

describe('buildRetrainSeries', () => {
  it('draws no overlay and claims nothing when there is no current series', () => {
    const out = buildRetrainSeries(
      series([{ timestamp: T(0), yTrue: 1, yPred: 1.5 }]),
      null,
      'Current v3',
    )
    expect(out.overlayNote).toBeNull()
    expect(out.sharedRowCount).toBe(0)
    expect(out.rows[0]?.comparePredict).toBeNull()
    expect(out.rows[0]?.compareResidual).toBeNull()
  })

  it('computes residual as actual minus predicted', () => {
    const out = buildRetrainSeries(
      series([{ timestamp: T(0), yTrue: 10, yPred: 7 }]),
      null,
      'Current v3',
    )
    expect(out.rows[0]?.residual).toBe(3)
  })

  it('pairs the current version by TIMESTAMP, not by row position', () => {
    // The real shape: the new version's rows are a subset of the current
    // version's, so index i is a different instant in each series.
    const candidate = series([
      { timestamp: T(5), yTrue: 5, yPred: 5.1 },
      { timestamp: T(6), yTrue: 6, yPred: 6.1 },
    ])
    const current = series([
      { timestamp: T(0), yTrue: 0, yPred: 90 },
      { timestamp: T(5), yTrue: 5, yPred: 4.0 },
      { timestamp: T(6), yTrue: 6, yPred: 7.0 },
      { timestamp: T(7), yTrue: 7, yPred: 70 },
    ])
    const out = buildRetrainSeries(candidate, current, 'Current v3')
    // Row 0 is 05:00 and must get the current version's 05:00 value (4.0),
    // never the 00:00 one an index pairing would have used (90).
    expect(out.rows[0]?.comparePredict).toBe(4.0)
    expect(out.rows[1]?.comparePredict).toBe(7.0)
    expect(out.rows[0]?.compareResidual).toBe(1)
  })

  it('says it is drawn on all rows when the two share every row', () => {
    const pts = [
      { timestamp: T(0), yTrue: 1, yPred: 1 },
      { timestamp: T(1), yTrue: 2, yPred: 2 },
    ]
    const out = buildRetrainSeries(series(pts), series(pts), 'Current v3')
    expect(out.sharedRowCount).toBe(2)
    expect(out.overlayNote).toBe(
      'Current v3 is drawn on all 2 rows both versions were scored on.',
    )
  })

  it('states the shared count when only some rows are shared, and leaves the rest null', () => {
    const out = buildRetrainSeries(
      series([
        { timestamp: T(0), yTrue: 1, yPred: 1 },
        { timestamp: T(1), yTrue: 2, yPred: 2 },
        { timestamp: T(2), yTrue: 3, yPred: 3 },
      ]),
      series([{ timestamp: T(1), yTrue: 2, yPred: 2.5 }]),
      'Current v3',
    )
    expect(out.sharedRowCount).toBe(1)
    expect(out.overlayNote).toBe(
      'Current v3 is drawn on the 1 of 3 rows both versions were scored on.',
    )
    expect(out.rows[0]?.comparePredict).toBeNull()
    expect(out.rows[1]?.comparePredict).toBe(2.5)
    expect(out.rows[2]?.comparePredict).toBeNull()
  })

  it('says so when the two share no rows, instead of drawing a misleading line', () => {
    const out = buildRetrainSeries(
      series([{ timestamp: T(0), yTrue: 1, yPred: 1 }]),
      series([{ timestamp: T(9), yTrue: 9, yPred: 9 }]),
      'Current v3',
    )
    expect(out.sharedRowCount).toBe(0)
    expect(out.overlayNote).toMatch(/not scored on any of these rows/)
    expect(out.rows[0]?.comparePredict).toBeNull()
  })

  it('uses the new version’s own residual SD for the bands', () => {
    const out = buildRetrainSeries(
      series([{ timestamp: T(0), yTrue: 1, yPred: 1 }], 0.25),
      series([{ timestamp: T(0), yTrue: 1, yPred: 1 }], 99),
      'Current v3',
    )
    expect(out.sd).toBe(0.25)
  })
})
