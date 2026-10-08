import { describe, it, expect } from 'vitest'
import {
  cvGapFolds,
  eventRmseDelta,
  labEventIndices,
  labEventMetrics,
  labEventSource,
  pairableOnSharedWindow,
  pairedEvents,
  primaryFigure,
  scoreRows,
} from './retrain-lab-events'
import type { EvalBasis } from '@/services/model-retrain'

describe('labEventMetrics (MODEL-SERVE-026-T03)', () => {
  it('V02 — one value held across 90% of rows, another across 10%: the event figure differs from the all-row figure', () => {
    // 18 rows of 100 predicted perfectly, 2 rows of 110 predicted 10 off.
    const points = [
      ...Array.from({ length: 18 }, () => ({ yTrue: 100, yPred: 100 })),
      ...Array.from({ length: 2 }, () => ({ yTrue: 110, yPred: 100 })),
    ]
    const m = labEventMetrics(points)
    expect(m.rows).toBe(20)
    expect(m.events).toBe(2)
    // All rows: the miss is diluted by 18 held perfect rows.
    expect(m.allRows.rmse).toBeCloseTo(Math.sqrt(200 / 20), 10)
    // Lab events: one hit, one miss — each measurement counted once.
    expect(m.atEvents.rmse).toBeCloseTo(Math.sqrt(100 / 2), 10)
    expect(m.atEvents.mae).toBeCloseTo(5, 10)
    expect(m.atEvents.rmse).not.toBeCloseTo(m.allRows.rmse!, 3)
  })

  it('equal hold durations give equal figures — the case that cannot tell the two apart', () => {
    const points = [
      { yTrue: 100, yPred: 101 },
      { yTrue: 100, yPred: 101 },
      { yTrue: 110, yPred: 108 },
      { yTrue: 110, yPred: 108 },
    ]
    const m = labEventMetrics(points)
    expect(m.atEvents.rmse).toBeCloseTo(m.allRows.rmse!, 10)
  })

  it('scores event rows at the FIRST row of each plateau and skips the blend row', () => {
    const points = [
      { yTrue: 100, yPred: 90 }, // event (start of plateau)
      { yTrue: 100, yPred: 100 },
      { yTrue: 105, yPred: 0 }, // blend — a huge miss that must NOT count
      { yTrue: 110, yPred: 110 }, // event
      { yTrue: 110, yPred: 110 },
    ]
    const m = labEventMetrics(points)
    expect(m.events).toBe(2)
    expect(m.atEvents.mae).toBeCloseTo(5, 10)
  })
})

describe('primaryFigure / eventRmseDelta (MODEL-SERVE-026-T03)', () => {
  const ready = (rmse: number | null) => ({
    status: 'ready' as const,
    events: 32,
    rows: 744,
    atEvents: { rmse, mae: 1, r2: 0.5 },
  })

  it('leads with the lab-event figure once ready', () => {
    expect(primaryFigure(ready(10.9), 'rmse', 12.0)).toEqual({
      basis: 'events',
      value: 10.9,
      events: 32,
    })
  })

  it('shows nothing while loading — never the all-row figure first and a different one later', () => {
    expect(primaryFigure({ status: 'loading' }, 'rmse', 12.0)).toEqual({
      basis: 'pending',
    })
  })

  it('falls back to the all-row figure, labelled with why, when the series cannot be read', () => {
    expect(
      primaryFigure({ status: 'unavailable', reason: 'gone' }, 'rmse', 12.0),
    ).toEqual({ basis: 'all-rows', value: 12.0, reason: 'gone' })
  })

  it('a lab-event delta needs both sides ready AND the server to call them comparable', () => {
    expect(eventRmseDelta(ready(10), ready(12), true)).toBeCloseTo(-2, 10)
    expect(eventRmseDelta(ready(10), ready(12), false)).toBeNull()
    expect(eventRmseDelta(ready(10), { status: 'loading' }, true)).toBeNull()
    expect(eventRmseDelta(ready(null), ready(12), true)).toBeNull()
  })
})

describe('pairedEvents (MODEL-SERVE-026-T04)', () => {
  // Nine lab events, each held for 2 rows. y_true steps by 10 so no row is a
  // blend. Per event: [candidate error, current error].
  const errors: [number, number][] = [
    [0, 30], // one LARGE candidate win
    [1, 2], // a small candidate win
    ...Array.from({ length: 7 }, (): [number, number] => [2, 1]), // 7 losses
  ]
  const build = (side: 0 | 1) =>
    errors.flatMap(([c, o], e) =>
      [0, 1].map(r => ({
        timestamp: `2026-01-01T${String(e * 2 + r).padStart(2, '0')}:00:00Z`,
        yTrue: 100 + e * 10,
        yPred: 100 + e * 10 + (side === 0 ? c : o),
      })),
    )

  it('V01 — candidate wins only 2 of 9 events yet wins on MEAN error: the win count says so', () => {
    const r = pairedEvents(build(0), build(1))
    expect(r.events).toHaveLength(9)
    expect(r.candidateWins).toBe(2)
    expect(r.currentWins).toBe(7)
    expect(r.ties).toBe(0)
    const mean = (k: 'candidateAbsError' | 'currentAbsError') =>
      r.events.reduce((s, e) => s + e[k], 0) / r.events.length
    // The aggregate points the other way — which is why it is not the result.
    expect(mean('candidateAbsError')).toBeLessThan(mean('currentAbsError'))
  })

  it('pairs by timestamp, counts a missing or mismatched current row as unmatched, and calls equal errors a tie', () => {
    const cand = [
      { timestamp: 'a', yTrue: 100, yPred: 101 },
      { timestamp: 'b', yTrue: 100, yPred: 101 },
      { timestamp: 'c', yTrue: 110, yPred: 112 },
      { timestamp: 'd', yTrue: 110, yPred: 112 },
      { timestamp: 'e', yTrue: 120, yPred: 120 },
      { timestamp: 'f', yTrue: 120, yPred: 120 },
    ]
    const cur = [
      { timestamp: 'a', yTrue: 100, yPred: 99 }, // tie: |1| == |1|
      { timestamp: 'c', yTrue: 999, yPred: 110 }, // different y_true -> unmatched
      // 'e' missing -> unmatched
    ]
    const r = pairedEvents(cand, cur)
    expect(r.events.map(e => e.winner)).toEqual(['tie'])
    expect(r.unmatched).toBe(2)
  })
})

describe('pairableOnSharedWindow (MODEL-SERVE-026-T04)', () => {
  const b = (frame: EvalBasis['frame']): EvalBasis => ({
    frame,
    from: null,
    to: null,
    rowCount: 1,
    usedFor: 'REPORT_ONLY',
    unavailableReason: null,
  })
  it('only when BOTH figures sit on the shared window', () => {
    expect(
      pairableOnSharedWindow({
        candidateMetricsBasis: b('NEW_DATA_WINDOW'),
        incumbentMetricsBasis: b('NEW_DATA_WINDOW'),
      }),
    ).toBe(true)
    expect(
      pairableOnSharedWindow({
        candidateMetricsBasis: b('FROZEN_INCUMBENT_TEST'),
        incumbentMetricsBasis: b('INCUMBENT_TEST_SPLIT'),
      }),
    ).toBe(false)
    expect(
      pairableOnSharedWindow({
        candidateMetricsBasis: null,
        incumbentMetricsBasis: b('NEW_DATA_WINDOW'),
      }),
    ).toBe(false)
  })
})

describe('cvGapFolds (MODEL-SERVE-026-T05)', () => {
  // One fold: 3 lab events, each held 2 rows (no blends). `errNew`/`errCur`
  // are per-event errors; `cutAfter` nulls the current prediction on the
  // first N rows (before the current version's own cut).
  const fold = (n: number, errNew: number[], errCur: number[], cutAfter = 0) =>
    errNew.flatMap((en, e) =>
      [0, 1].map(r => {
        const i = e * 2 + r
        const y = 100 + e * 10
        return {
          fold: n,
          timestamp: `2026-0${n}-01T${String(i).padStart(2, '0')}:00:00Z`,
          yTrue: y,
          yPred: y + en,
          yPredCurrent: i < cutAfter ? null : y + (errCur[e] ?? 0),
        }
      }),
    )

  it('scores both versions per fold at lab events and states the spread over 3 usable folds', () => {
    const s = cvGapFolds([
      ...fold(1, [1, 1, 1], [3, 3, 3]), // new better by 2
      ...fold(2, [2, 2, 2], [3, 3, 3]), // new better by 1
      ...fold(3, [4, 4, 4], [3, 3, 3]), // new WORSE by 1
    ])
    expect(s.folds.map(f => f.events)).toEqual([3, 3, 3])
    expect(s.folds.map(f => f.delta)).toEqual([-2, -1, 1])
    expect(s.usableFolds).toBe(3)
    expect(s.newBetterFolds).toBe(2)
    expect(s.spread).toEqual({ min: -2, max: 1 })
  })

  it('never scores the current version on rows before its cut, and a fold with too few events is unusable', () => {
    const s = cvGapFolds([
      // 5 of 6 rows before the cut: one scored row -> < 2 events -> unusable.
      ...fold(1, [1, 1, 1], [3, 3, 3], 5),
      ...fold(2, [1, 1, 1], [3, 3, 3]),
    ])
    expect(s.folds[0]).toMatchObject({ rows: 6, scoredRows: 1, usable: false })
    expect(s.usableFolds).toBe(1)
  })

  it('states no spread below 3 usable folds', () => {
    const s = cvGapFolds([
      ...fold(1, [1, 1, 1], [3, 3, 3]),
      ...fold(2, [1, 1, 1], [3, 3, 3]),
    ])
    expect(s.usableFolds).toBe(2)
    expect(s.spread).toBeNull()
  })
})

describe('scoreRows (MODEL-SERVE-026-T03)', () => {
  it('no rows: every figure null, never 0', () => {
    expect(scoreRows([])).toEqual({ rmse: null, mae: null, r2: null })
  })

  it('a constant target has no R² — null, not the 0 a real retrain displayed', () => {
    const m = scoreRows([
      { yTrue: 101.4, yPred: 87 },
      { yTrue: 101.4, yPred: 86 },
    ])
    expect(m.r2).toBeNull()
    expect(m.rmse).not.toBeNull()
  })

  it('a single row has no R²', () => {
    expect(scoreRows([{ yTrue: 1, yPred: 2 }]).r2).toBeNull()
  })
})

describe('labEventIndices (MODEL-SERVE-026-T02)', () => {
  it('counts one event per held plateau and skips the blended row between them — the real shape', () => {
    // 103.7 held, one blended hourly row, 99.2 held, one blend, 101.0 held —
    // as measured on job eaa66ebf. Float32 noise on the held values.
    const y = [
      103.699997, 103.699997, 103.699997, 103.624997, 99.199997, 99.199997,
      99.199997, 99.199997, 100.1, 101.0, 101.0,
    ]
    expect(labEventIndices(y)).toEqual([0, 4, 9])
  })

  it('held rows far outnumber events: 3 events on 30 rows, not 30 and not 5 value changes', () => {
    const y = [
      ...Array(12).fill(90),
      91,
      ...Array(8).fill(92),
      93.5,
      ...Array(8).fill(95),
    ]
    expect(y).toHaveLength(30)
    expect(labEventIndices(y)).toHaveLength(3)
  })

  it('keeps a one-row run that is NOT between its neighbours (a spike)', () => {
    expect(labEventIndices([90, 90, 120, 91, 91])).toEqual([0, 2, 3])
  })

  it('keeps one-row runs at either edge — there is no neighbour to call them a blend', () => {
    expect(labEventIndices([88, 90, 90, 92])).toEqual([0, 1, 3])
  })

  it('returns nothing for an empty series and one event for a single row', () => {
    expect(labEventIndices([])).toEqual([])
    expect(labEventIndices([99])).toEqual([0])
  })
})

describe('labEventSource (MODEL-SERVE-026-T02)', () => {
  const basis = (frame: EvalBasis['frame']): EvalBasis => ({
    frame,
    from: null,
    to: null,
    rowCount: 1,
    usedFor: 'REPORT_ONLY',
    unavailableReason: null,
  })
  const ids = { candidateRunId: 'cand', incumbentSourceRunId: 'inc' }

  it('reads the shared window from the candidate run for BOTH versions, on different populations', () => {
    expect(labEventSource(basis('NEW_DATA_WINDOW'), 'candidate', ids)).toEqual({
      kind: 'series',
      runId: 'cand',
      population: 'new_data_holdout',
    })
    expect(labEventSource(basis('NEW_DATA_WINDOW'), 'incumbent', ids)).toEqual({
      kind: 'series',
      runId: 'cand',
      population: 'current_new_data_holdout',
    })
  })

  it('maps each remaining frame to the file covering its rows', () => {
    expect(
      labEventSource(basis('MERGED_TEST_SPLIT'), 'candidate', ids),
    ).toMatchObject({ runId: 'cand', population: 'test' })
    expect(
      labEventSource(basis('FROZEN_INCUMBENT_TEST'), 'candidate', ids),
    ).toMatchObject({ runId: 'cand', population: 'holdout' })
    expect(
      labEventSource(basis('INCUMBENT_TEST_SPLIT'), 'incumbent', ids),
    ).toMatchObject({ runId: 'inc', population: 'test' })
  })

  it('says why when the run that holds the series does not exist', () => {
    const none = { candidateRunId: null, incumbentSourceRunId: null }
    expect(labEventSource(basis('NEW_DATA_WINDOW'), 'candidate', none)).toEqual(
      {
        kind: 'unavailable',
        reason: 'no finished new version',
      },
    )
    expect(
      labEventSource(basis('INCUMBENT_TEST_SPLIT'), 'incumbent', none),
    ).toEqual({
      kind: 'unavailable',
      reason: 'current version has no source run',
    })
  })
})
