import { describe, it, expect } from 'vitest'
import {
  binIndex,
  columnDrift,
  errorMetrics,
  inferenceStatus,
  inputDrift,
  mockResponse,
  scheduledSeries,
  shiftMsFor,
  truth,
  type MockupModel,
  type MonitoringFixture,
} from '../monitoring-mockup'
import realFixture from '@/components/dev/monitoring-mockup-data.json'

const HOUR = 3_600_000
const MODEL: MockupModel = {
  modelId: 'm1',
  modelVersionId: 'v1',
  version: 1,
  baselineSd: 2,
}

/** 48 hourly windows from T0; lab every 4 h; column A drifts above range in
 *  the last 6 hours only. */
const T0 = Date.parse('2026-01-01T00:00:00Z')
function fixture(): MonitoringFixture {
  const hours = Array.from({ length: 48 }, (_, i) =>
    new Date(T0 + i * HOUR).toISOString(),
  )
  return {
    generatedAt: hours[0]!,
    target: 'LAB',
    featureColumns: ['A', 'A__lag1'],
    hours,
    pred: hours.map(() => 10),
    features: {
      A: hours.map((_, i) => (i >= 42 ? 200 : 50)),
      A__lag1: hours.map(() => 50),
    },
    lab: hours
      .filter((_, i) => i % 4 === 0)
      .map((h, k) => [h, k % 2 === 0 ? 12 : 8] as [string, number]),
    ref: {
      A: { edges: [0, 50, 100], counts: [5, 5], binMode: 'continuous' },
      A__lag1: { edges: [0, 50, 100], counts: [5, 5], binMode: 'continuous' },
    },
    targetRef: { edges: [0, 10, 20], counts: [3, 3] },
  }
}
/** "now" such that the fixture's last hour is the hour just before it. */
const NOW = T0 + 48 * HOUR + 15 * 60_000

describe('monitoring mockup (dev document fixture)', () => {
  it('slides the block so its last window ends at the current hour', () => {
    expect(shiftMsFor(fixture(), NOW)).toBe(0)
    expect(shiftMsFor(fixture(), NOW + 5 * HOUR)).toBe(5 * HOUR)
  })

  it('scheduled series returns one hourly point per window in range', () => {
    const r = scheduledSeries(fixture(), MODEL, T0, T0 + 9 * HOUR, NOW)
    expect(r.points).toHaveLength(10)
    expect(r.points[0]).toMatchObject({ mean: 10, rowCount: 1, std: 0 })
    expect(r.windows).toBe(10)
  })

  it('truth pairs each lab sample with its window and scores the error', () => {
    const r = truth(fixture(), MODEL, T0, T0 + 47 * HOUR, NOW)
    expect(r.points).toHaveLength(12)
    expect(r.points[0]).toMatchObject({
      predicted: 10,
      actual: 12,
      residual: 2,
    })
    expect(r.metrics).toMatchObject({ n: 12, mae: 2, rmse: 2, bias: 0 })
    expect(r.coverage.windowsJoined).toBe(12)
    expect(r.coverage.windowsInRange).toBe(48)
    expect(r.targetHeld?.tag).toBe('LAB')
  })

  it('errorMetrics is null with no pairs, never zeros', () => {
    expect(errorMetrics([])).toBeNull()
  })

  it('bins continuous values with a closed last bin', () => {
    expect(binIndex([0, 50, 100], 0)).toBe(0)
    expect(binIndex([0, 50, 100], 50)).toBe(1)
    expect(binIndex([0, 50, 100], 100)).toBe(1)
  })

  it('grades a column by out-of-range share: 6 of 48 above = 12.5% → WARN', () => {
    const r = inputDrift(
      fixture(),
      MODEL,
      new Date(T0).toISOString(),
      new Date(T0 + 47 * HOUR).toISOString(),
      NOW,
    )
    const a = r.columns.find(c => c.column === 'A')!
    expect(a).toMatchObject({
      above: 6,
      below: 0,
      outOfRangePct: 12.5,
      status: 'WARN',
    })
    expect(a.bins?.liveCounts).toEqual([0, 42])
    expect(r.status).toBe('WARN')
    expect(r.series.A?.lastOutOfRangeAt).toBe(
      new Date(T0 + 47 * HOUR).toISOString(),
    )
  })

  it('reports too few samples as INSUFFICIENT_DATA, and no range as UNKNOWN', () => {
    expect(
      columnDrift('X', [1, 2], { edges: [0, 5], counts: [2] }).status,
    ).toBe('INSUFFICIENT_DATA')
    expect(columnDrift('X', [1, 2], null).status).toBe('UNKNOWN')
  })

  it('status shows a running model; 24 one-row windows are too few to grade drift', () => {
    const s = inferenceStatus(fixture(), MODEL, NOW)
    expect(s.deployStatus).toBe('running')
    expect(s.enabled).toBe(true)
    // A is out of range in 6 of the newest 24 windows, but 24 samples are
    // under the 30-sample minimum — INSUFFICIENT_DATA never raises health.
    expect(s.health).toMatchObject({ status: 'OK', reason: null })
    expect(s.health.residualSd).toMatchObject({ status: 'OK', baselineSd: 2 })
  })

  it('a live residual SD 1.5x the baseline raises RESIDUAL_SD_WARN', () => {
    const s = inferenceStatus(fixture(), { ...MODEL, baselineSd: 1 }, NOW)
    expect(s.health.residualSd.status).toBe('WARN')
    expect(s.health).toMatchObject({
      status: 'WARN',
      reason: 'RESIDUAL_SD_WARN',
    })
  })

  it('pairsOnly drops the scheduled series and the held value, keeping every pair', () => {
    const f = { ...fixture(), pairsOnly: true }
    expect(scheduledSeries(f, MODEL, T0, T0 + 47 * HOUR, NOW).points).toEqual(
      [],
    )
    const r = truth(f, MODEL, T0, T0 + 47 * HOUR, NOW)
    expect(r.targetHeld).toBeNull()
    expect(r.points).toHaveLength(12)
  })

  it('routes only the monitoring reads of the mocked model', () => {
    const at = (path: string) =>
      new URL(`http://api.test/api/v1/authorized/model/${path}`)
    const f = fixture()
    expect(mockResponse(f, MODEL, at('m1/inference/status'), NOW)).toBeDefined()
    expect(
      mockResponse(f, MODEL, at('m1/inference/manual-predictions'), NOW),
    ).toEqual({ points: [] })
    expect(mockResponse(f, MODEL, at('m1/input-schema'), NOW)).toBeUndefined()
    expect(
      mockResponse(f, MODEL, at('other/inference/status'), NOW),
    ).toBeUndefined()
  })

  it('the generated ModelTest 1 fixture builds every response', () => {
    const f = realFixture as unknown as MonitoringFixture
    const now = Date.now()
    const to = new Date(now).toISOString()
    const from = new Date(now - 30 * 24 * HOUR).toISOString()
    expect(f.hours).toHaveLength(f.pred.length)
    expect(f.featureColumns).toHaveLength(116)
    const drift = inputDrift(f, MODEL, from, to, now)
    expect(drift.columns).toHaveLength(116)
    expect(drift.columns.every(c => c.trainMin !== null)).toBe(true)
    expect(
      truth(f, MODEL, Date.parse(from), now, now).points.length,
    ).toBeGreaterThan(100)
    expect(inferenceStatus(f, MODEL, now).deployStatus).toBe('running')
  })
})
