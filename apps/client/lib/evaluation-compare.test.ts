import { describe, expect, it } from 'vitest'
import {
  buildChartRows,
  defaultRange,
  labFromEvents,
  mergeLab,
  pairLab,
  predictedSeries,
  stampToUtcIso,
  utcToStamp,
  utcToWallMs,
  validateRange,
  xRows,
} from './evaluation-compare'
import type { EvaluationCompareResult } from '@/services/model-evaluation'

type Points = EvaluationCompareResult['points']

const p = (t: string, predicted: number | null): Points[number] => ({
  t,
  predicted,
  skippedReason:
    predicted === null
      ? 'Input not usable — A did not report Good values.'
      : null,
})

function result(
  points: Points,
  tol = 30,
  features: Record<string, Array<number | null>> = {},
) {
  return { points, toleranceMinutes: tol, features }
}

describe('plant wall clock <-> UTC', () => {
  it('reads a picked stamp as Bangkok time (UTC+7)', () => {
    expect(stampToUtcIso('2026-10-14T07:00')).toBe('2026-10-14T00:00:00.000Z')
    // crosses the day boundary backwards
    expect(stampToUtcIso('2026-10-14T03:30')).toBe('2026-10-13T20:30:00.000Z')
  })

  it('rejects anything that is not yyyy-MM-ddTHH:mm', () => {
    expect(stampToUtcIso('')).toBeNull()
    expect(stampToUtcIso('2026-10-14')).toBeNull()
    expect(stampToUtcIso('2026-10-14 07:00')).toBeNull()
    expect(stampToUtcIso('2026-13-40T07:00')).toBeNull()
  })

  it('round-trips stamp -> UTC -> stamp for any instant, independent of the browser zone', () => {
    for (const s of [
      '2026-10-14T07:00',
      '2026-01-01T00:00',
      '2026-12-31T23:59',
    ]) {
      const iso = stampToUtcIso(s)!
      expect(utcToStamp(Date.parse(iso))).toBe(s)
    }
  })

  it('the chart epoch carries Bangkok digits in its UTC fields (what lib/monitoring formats)', () => {
    const wall = new Date(utcToWallMs('2026-10-14T00:00:00.000Z'))
    expect(wall.getUTCHours()).toBe(7)
    expect(wall.getUTCDate()).toBe(14)
  })

  it('defaultRange is the 24h ending now, to the minute', () => {
    const now = Date.parse('2026-10-14T05:30:45.000Z') // 12:30 Bangkok
    expect(defaultRange(now)).toEqual({
      from: '2026-10-13T12:30',
      to: '2026-10-14T12:30',
    })
  })
})

describe('validateRange', () => {
  it('accepts a normal window', () => {
    expect(validateRange('2026-10-13T12:00', '2026-10-14T12:00')).toBeNull()
  })

  it('names the problem', () => {
    expect(validateRange('', '2026-10-14T12:00')).toMatch(
      /both a start and an end/,
    )
    expect(validateRange('2026-10-14T12:00', '2026-10-14T12:00')).toMatch(
      /after the start/,
    )
    expect(validateRange('2026-10-15T12:00', '2026-10-14T12:00')).toMatch(
      /after the start/,
    )
    expect(validateRange('2026-09-01T00:00', '2026-10-14T00:00')).toMatch(
      /31 days/,
    )
  })

  it('allows exactly 31 days', () => {
    expect(validateRange('2026-09-13T00:00', '2026-10-14T00:00')).toBeNull()
  })
})

describe('predictedSeries', () => {
  it('drops unscored rows rather than turning them into zeros', () => {
    const r = result([
      p('2026-10-14T00:00:00Z', 1),
      p('2026-10-14T00:01:00Z', null),
      p('2026-10-14T00:02:00Z', 3),
    ])
    expect(predictedSeries(r).map(x => x.predicted)).toEqual([1, 3])
  })
})

describe('mergeLab', () => {
  const a = { timestamp: '2026-10-14T01:00:00.000Z', value: 1 }
  const b = { timestamp: '2026-10-14T02:00:00.000Z', value: 2 }

  it('sorts by time', () => {
    expect(mergeLab([b], [a]).map(x => x.value)).toEqual([1, 2])
  })

  it('a user-added point wins a collision with an imported one, even spelled differently', () => {
    const edited = { timestamp: '2026-10-14T01:00:00Z', value: 99 }
    expect(mergeLab([a], [edited])).toEqual([edited])
  })
})

describe('pairLab', () => {
  const pts = [
    p('2026-10-14T00:00:00Z', 10),
    p('2026-10-14T00:01:00Z', null),
    p('2026-10-14T00:02:00Z', 12),
  ]

  it('pairs a lab point with the nearest SCORED prediction within tolerance', () => {
    const out = pairLab(result(pts, 5), [
      { timestamp: '2026-10-14T00:02:00Z', value: 11 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.timestamp).toBe('2026-10-14T00:02:00Z')
    expect(out[0]?.actual).toBe(11)
    expect(out[0]?.predicted).toBe(12)
    expect(out[0]?.residual).toBe(1)
  })

  it('does not pair across the tolerance', () => {
    expect(
      pairLab(result(pts, 1), [
        { timestamp: '2026-10-14T05:00:00Z', value: 1 },
      ]),
    ).toEqual([])
  })

  it('an unscored row never becomes a pair', () => {
    // The only lab point sits on the unscored minute; the nearest scored rows are 1 min away.
    const out = pairLab(result(pts, 0), [
      { timestamp: '2026-10-14T00:01:00Z', value: 5 },
    ])
    expect(out).toEqual([])
  })
})

describe('buildChartRows', () => {
  const grid: Points = [
    p('2026-10-14T00:00:00Z', 10),
    p('2026-10-14T00:01:00Z', null),
    p('2026-10-14T00:02:00Z', 12),
  ]

  it('keeps one row per imported point and never adds lab-only rows (they would break the line)', () => {
    const rows = buildChartRows({ points: grid }, [
      { timestamp: '2026-10-14T00:00:30Z', value: 7 },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.predicted)).toEqual([10, null, 12])
  })

  it('keeps a gap a gap and carries the reason', () => {
    const rows = buildChartRows({ points: grid }, [])
    expect(rows[1]?.predicted).toBeNull()
    expect(rows[1]?.skippedReason).toMatch(/did not report Good/)
  })

  it('snaps a lab value to the nearest row but remembers its true time', () => {
    const rows = buildChartRows({ points: grid }, [
      { timestamp: '2026-10-14T00:01:50Z', value: 7 },
    ])
    expect(rows[2]?.lab).toBe(7)
    expect(rows[2]?.labAt).toBe(utcToWallMs('2026-10-14T00:01:50Z'))
    expect(rows[0]?.lab).toBeNull()
  })

  it('when two lab values want one row, the closer wins', () => {
    const rows = buildChartRows({ points: grid }, [
      { timestamp: '2026-10-14T00:00:20Z', value: 1 },
      { timestamp: '2026-10-14T00:00:05Z', value: 2 },
    ])
    expect(rows[0]?.lab).toBe(2)
  })

  it('drops a lab event far outside the imported span', () => {
    const rows = buildChartRows({ points: grid }, [
      { timestamp: '2026-10-14T09:00:00Z', value: 1 },
    ])
    expect(rows.every(r => r.lab === null)).toBe(true)
  })

  it('handles an empty import', () => {
    expect(
      buildChartRows({ points: [] }, [
        { timestamp: '2026-10-14T00:00:00Z', value: 1 },
      ]),
    ).toEqual([])
  })

  it('plots on the plant wall-clock epoch', () => {
    const [row] = buildChartRows({ points: [p('2026-10-14T00:00:00Z', 1)] }, [])
    expect(new Date(row?.t ?? 0).getUTCHours()).toBe(7)
  })
})

describe('xRows', () => {
  it('aligns a tag with the grid and keeps Bad cells null', () => {
    const r = {
      points: [p('2026-10-14T00:00:00Z', 1), p('2026-10-14T00:01:00Z', 2)],
      features: { A: [5, null] },
    }
    expect(xRows(r, 'A').map(x => x.v)).toEqual([5, null])
    expect(xRows(r, 'MISSING').map(x => x.v)).toEqual([null, null])
  })
})

describe('labFromEvents', () => {
  it('maps server events onto LabPoint', () => {
    expect(labFromEvents([{ t: 'x', value: 1 }])).toEqual([
      { timestamp: 'x', value: 1 },
    ])
  })
})
