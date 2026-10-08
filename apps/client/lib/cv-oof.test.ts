import { describe, expect, it } from 'vitest'
import type { CvFoldRecord, RunPredictionPoint } from '@/services/model-draft'
import { parseServerTimestamp } from '@/lib/monitoring'
import {
  buildOofSeries,
  foldColor,
  foldCutXs,
  foldCutsOf,
  foldKey,
  foldOf,
  toMs,
} from './cv-oof'

function fold(n: number, cut: string): CvFoldRecord {
  return {
    fold: n,
    cut_timestamp: cut,
    train_rows: 10 * n,
    test_rows: 5,
    distinct: 10,
    r2: 0.9,
    rmse: 1,
    mae: 1,
    train_r2: 0.95,
    train_rmse: 0.5,
    train_mae: 0.5,
  }
}

const FOLDS = [
  fold(1, '2026-01-01 10:00:00'),
  fold(2, '2026-01-01 20:00:00'),
  fold(3, '2026-01-02 06:00:00'),
]

function point(ts: string, yTrue = 1, yPred = 2): RunPredictionPoint {
  return { timestamp: ts, yTrue, yPred }
}

describe('foldOf', () => {
  const cuts = foldCutsOf(FOLDS)

  it('puts a point exactly at a cut into the fold that cut opens', () => {
    expect(foldOf(toMs('2026-01-01 10:00:00'), cuts)).toBe(1)
    expect(foldOf(toMs('2026-01-01 20:00:00'), cuts)).toBe(2)
  })

  it('keeps the last instant before a cut in the previous fold', () => {
    expect(foldOf(toMs('2026-01-01 19:59:59'), cuts)).toBe(1)
  })

  it('returns null before the first cut rather than guessing fold 1', () => {
    expect(foldOf(toMs('2026-01-01 09:59:59'), cuts)).toBeNull()
  })

  it('assigns everything after the last cut to the last fold', () => {
    expect(foldOf(toMs('2026-02-01 00:00:00'), cuts)).toBe(3)
  })
})

describe('foldCutsOf', () => {
  it('sorts ascending even when the folds arrive out of order', () => {
    const shuffled = [FOLDS[2]!, FOLDS[0]!, FOLDS[1]!]
    expect(foldCutsOf(shuffled).map(c => c.fold)).toEqual([1, 2, 3])
  })

  it('drops a cut whose timestamp does not parse', () => {
    expect(foldCutsOf([fold(1, 'not a date'), FOLDS[1]!])).toHaveLength(1)
  })
})

describe('buildOofSeries', () => {
  it('places each prediction under its own fold key and nulls the others', () => {
    const { rows, folds } = buildOofSeries(
      [
        point('2026-01-01 11:00:00', 1, 1.5),
        point('2026-01-01 21:00:00', 2, 2.5),
      ],
      FOLDS,
    )
    expect(folds).toEqual([1, 2, 3])
    expect(rows[0]).toMatchObject({
      actual: 1,
      [foldKey(1)]: 1.5,
      [foldKey(2)]: null,
      [foldKey(3)]: null,
    })
    expect(rows[1]).toMatchObject({ actual: 2, [foldKey(2)]: 2.5 })
  })

  it('orders rows by time whatever order the points arrive in', () => {
    const { rows } = buildOofSeries(
      [point('2026-01-02 07:00:00'), point('2026-01-01 11:00:00')],
      FOLDS,
    )
    expect(rows.map(r => r.t)).toEqual([...rows.map(r => r.t)].sort())
  })

  it('counts, and does not plot, points before the first cut', () => {
    const out = buildOofSeries(
      [point('2026-01-01 09:00:00'), point('2026-01-01 11:00:00')],
      FOLDS,
    )
    expect(out.unassigned).toBe(1)
    expect(out.rows).toHaveLength(1)
  })

  it('is empty, not an error, for no points', () => {
    expect(buildOofSeries([], FOLDS).rows).toEqual([])
  })
})

describe('foldColor', () => {
  it('cycles the five chart tokens', () => {
    expect(foldColor(0)).toBe('var(--chart-1)')
    expect(foldColor(4)).toBe('var(--chart-5)')
    expect(foldColor(5)).toBe('var(--chart-1)')
  })
})

describe('foldCutXs (MODEL-FLOW-030)', () => {
  it('returns each cut ascending, even when the folds arrive out of order', () => {
    const xs = foldCutXs([FOLDS[2]!, FOLDS[0]!, FOLDS[1]!])
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(xs).toHaveLength(3)
  })

  it('shares the normal chart rows’ clock, so a line sits exactly on the row it opens', () => {
    // buildMonitoringRows parses a row's timestamp with parseServerTimestamp;
    // a fold line parsed any other way would be off by the viewer's timezone.
    const [x] = foldCutXs([FOLDS[0]!])
    expect(x).toBe(parseServerTimestamp(FOLDS[0]!.cut_timestamp))
  })

  it('is empty when no fold has a usable cut', () => {
    expect(foldCutXs([fold(1, 'not a date')])).toEqual([])
  })
})
