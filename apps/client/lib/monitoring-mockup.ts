/**
 * Dev-only document mockup: the Monitoring tab's API answers, built from a
 * fixture generated off the fake PI Web API (apps/python/dev/
 * monitoring_mockup_fixture.py — real feature recipes, the model's own
 * model.joblib, the lab tag as PI records it). Pure: every function takes
 * the fixture, the requested range and the clock, so it is table-testable.
 *
 * The fixture is a fixed 31-day block; `shiftMsFor` slides it so its last
 * hour is the hour before `now`, keeping a screenshot "live-looking"
 * whenever it is taken. Semantics mirror the backend reads they stand in
 * for (inference-window-monitoring / truth / scheduled-series): 1 h
 * windows, 5 % / 20 % out-of-range grading, 30-sample minimum, a 600-point
 * trend cap, warnSd 1.5 / criticalSd 3.0 on the residual-SD ratio.
 */

import type {
  InferenceStatus,
  LiveErrorMetrics,
  LiveErrorResult,
  ScheduledSeriesResult,
} from '@/services/inference-window'
import type {
  ColumnRangeDrift,
  InputDriftReport,
  InputDriftStatus,
  InputTrendSeries,
} from '@/services/model-monitoring'

export interface MonitoringFixture {
  generatedAt: string
  target: string
  featureColumns: string[]
  hours: string[]
  pred: number[]
  features: Record<string, Array<number | null>>
  lab: Array<[string, number]>
  ref: Record<
    string,
    {
      edges: number[]
      counts: number[] | null
      binMode: 'continuous' | 'categorical'
    }
  >
  targetRef: { edges: number[] | null; counts: number[] | null }
  /**
   * The lab is sampled every hour (generator `--clean-lab`), so every window
   * is a measured pair. The chart then needs only Actual, Predict and the
   * ±1 SD band: the scheduled series (a duplicate of Predict at the same
   * hours) and the held last-value step are left out.
   */
  pairsOnly?: boolean
}

export interface MockupModel {
  modelId: string
  modelVersionId: string
  version: number
  /** The training run's own residual SD — the residual-SD baseline. */
  baselineSd: number
}

const HOUR = 3_600_000
const WARN_PCT = 5
const CRITICAL_PCT = 20
const MIN_SAMPLES = 30
const TREND_MAX_POINTS = 600
const WARN_SD = 1.5
const CRITICAL_SD = 3.0
const HEALTH_WINDOWS = 24

/** Slide the fixture so its last window ends at the start of `now`'s hour. */
export function shiftMsFor(fixture: MonitoringFixture, now: number): number {
  const last = Date.parse(fixture.hours[fixture.hours.length - 1]!)
  const currentHour = Math.floor(now / HOUR) * HOUR
  return currentHour - (last + HOUR)
}

const iso = (ms: number) => new Date(ms).toISOString()

interface Hour {
  index: number
  start: number
}

function hoursIn(
  fixture: MonitoringFixture,
  shift: number,
  from: number,
  to: number,
): Hour[] {
  const out: Hour[] = []
  fixture.hours.forEach((h, index) => {
    const start = Date.parse(h) + shift
    if (start >= from && start <= to) out.push({ index, start })
  })
  return out
}

interface Pair {
  t: number
  predicted: number
  actual: number
  windowStart: number
}

function pairsIn(
  fixture: MonitoringFixture,
  shift: number,
  from: number,
  to: number,
): Pair[] {
  const byHour = new Map(
    fixture.hours.map((h, i) => [Date.parse(h), fixture.pred[i]!]),
  )
  const out: Pair[] = []
  for (const [stamp, actual] of fixture.lab) {
    const raw = Date.parse(stamp)
    const t = raw + shift
    if (t < from || t > to) continue
    const windowStart = Math.floor(raw / HOUR) * HOUR
    const predicted = byHour.get(windowStart)
    if (predicted === undefined) continue
    out.push({ t, predicted, actual, windowStart: windowStart + shift })
  }
  return out
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export function errorMetrics(
  pairs: Array<{ predicted: number; actual: number }>,
): LiveErrorMetrics | null {
  if (pairs.length === 0) return null
  const n = pairs.length
  const residuals = pairs.map(p => p.actual - p.predicted)
  const bias = residuals.reduce((a, b) => a + b, 0) / n
  const mae = residuals.reduce((a, b) => a + Math.abs(b), 0) / n
  const rmse = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / n)
  const sd = Math.sqrt(
    residuals.reduce((a, b) => a + (b - bias) ** 2, 0) / Math.max(n - 1, 1),
  )
  const mean = pairs.reduce((a, p) => a + p.actual, 0) / n
  const ssTot = pairs.reduce((a, p) => a + (p.actual - mean) ** 2, 0)
  const ssRes = residuals.reduce((a, b) => a + b * b, 0)
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  return {
    r2: round(r2),
    rmse: round(rmse),
    mae: round(mae),
    sd: round(sd),
    bias: round(bias),
    n,
  }
}

// ── scheduled series (the hourly prediction line) ───────────────────────

export function scheduledSeries(
  fixture: MonitoringFixture,
  model: MockupModel,
  from: number,
  to: number,
  now: number,
): ScheduledSeriesResult {
  if (fixture.pairsOnly) return { points: [], windows: 0, missing: 0 }
  const shift = shiftMsFor(fixture, now)
  const points = hoursIn(fixture, shift, from, to).map(({ index, start }) => {
    const p = fixture.pred[index]!
    return {
      windowStart: iso(start),
      windowEnd: iso(start + HOUR),
      rowCount: 1,
      mean: p,
      min: p,
      max: p,
      std: 0,
      modelVersionId: model.modelVersionId,
    }
  })
  return { points, windows: points.length, missing: 0 }
}

// ── truth (Actual vs Predict, live error) ───────────────────────────────

export function truth(
  fixture: MonitoringFixture,
  model: MockupModel,
  from: number,
  to: number,
  now: number,
): LiveErrorResult {
  const shift = shiftMsFor(fixture, now)
  const pairs = pairsIn(fixture, shift, from, to)
  const windowsInRange = hoursIn(fixture, shift, from, to).length
  const metrics = errorMetrics(pairs)
  const lastLab = fixture.lab[fixture.lab.length - 1]
  const lastMeasured = lastLab ? Date.parse(lastLab[0]) + shift : null
  const lastHourEnd = Date.parse(fixture.hours.at(-1)!) + shift + HOUR
  // Windows after the newest lab sample are still waiting for one.
  const awaiting = Math.min(
    windowsInRange,
    lastMeasured === null
      ? 0
      : Math.max(0, Math.floor((lastHourEnd - lastMeasured) / HOUR) - 1),
  )
  return {
    points: pairs.map(p => ({
      timestamp: iso(p.t),
      predicted: p.predicted,
      actual: p.actual,
      residual: round(p.actual - p.predicted),
    })),
    truncated: false,
    metrics,
    mixedVersions: false,
    versions: [
      {
        modelVersionId: model.modelVersionId,
        targetColumn: fixture.target,
        metrics,
        pairedRows: pairs.length,
        windows: windowsInRange,
      },
    ],
    targetColumn: fixture.target,
    coverage: {
      windowsInRange,
      windowsSkipped: 0,
      windowsJoined: pairs.length,
      windowsAwaitingTruth: awaiting,
      truthRows: pairs.length,
      pairedRows: pairs.length,
      windowsFailed: 0,
      maxMissingPct: 0,
      truthLagMinutes: 0,
      earliestEligibleAt: null,
      windowsLapsedTruth: Math.max(0, windowsInRange - pairs.length - awaiting),
      predictionRows: windowsInRange,
      cadenceMinutes: 60,
    },
    targetHeld:
      !fixture.pairsOnly && lastLab && lastMeasured !== null
        ? {
            tag: fixture.target,
            value: lastLab[1],
            lastMeasuredAt: iso(lastMeasured),
            lastSeenAt: iso(lastHourEnd),
            heldForMinutes: Math.round((lastHourEnd - lastMeasured) / 60_000),
          }
        : null,
    windows: pairs.map(p => ({
      windowStart: iso(p.windowStart),
      targetColumn: fixture.target,
      modelVersionId: model.modelVersionId,
      truthRows: 1,
      pairedRows: 1,
      n: 1,
      missingPct: 0,
      joinedThrough: iso(p.windowStart + HOUR),
      failureReason: null,
    })),
  }
}

// ── input drift (training-range rule) ───────────────────────────────────

function gradePct(pct: number | null, total: number): InputDriftStatus {
  if (pct === null) return 'UNKNOWN'
  if (total < MIN_SAMPLES) return 'INSUFFICIENT_DATA'
  if (pct >= CRITICAL_PCT) return 'CRITICAL'
  if (pct >= WARN_PCT) return 'WARN'
  return 'OK'
}

const RANK: Record<InputDriftStatus, number> = {
  OK: 1,
  WARN: 2,
  CRITICAL: 3,
  UNKNOWN: 0,
  INSUFFICIENT_DATA: 0,
}

/** Continuous bins over `edges` (binCount + 1 boundaries, last bin closed). */
export function binIndex(edges: number[], v: number): number {
  const last = edges.length - 2
  for (let i = 0; i < last; i++) {
    if (v < edges[i + 1]!) return i
  }
  return last
}

export function columnDrift(
  column: string,
  values: number[],
  ref: { edges: number[]; counts: number[] | null } | null,
): ColumnRangeDrift {
  if (!ref || ref.edges.length < 2) {
    return {
      column,
      liveTotal: values.length,
      below: 0,
      above: 0,
      outOfRangePct: null,
      trainMin: null,
      trainMax: null,
      binMode: null,
      status: 'UNKNOWN',
      reason: 'No training range recorded for this column.',
      bins: null,
    }
  }
  const { edges } = ref
  const lo = edges[0]!
  const hi = edges[edges.length - 1]!
  const binCount = edges.length - 1
  const liveCounts = new Array<number>(binCount).fill(0)
  let below = 0
  let above = 0
  for (const v of values) {
    if (v < lo) below += 1
    else if (v > hi) above += 1
    else liveCounts[binIndex(edges, v)]! += 1
  }
  const total = values.length
  const pct = total === 0 ? null : round(((below + above) / total) * 100, 2)
  return {
    column,
    liveTotal: total,
    below,
    above,
    outOfRangePct: pct,
    trainMin: lo,
    trainMax: hi,
    binMode: 'continuous',
    status: gradePct(pct, total),
    bins: {
      binMode: 'continuous',
      binCount,
      edges,
      refCounts: ref.counts ?? new Array<number>(binCount).fill(0),
      liveCounts,
      below,
      above,
      liveInRangeTotal: total - below - above,
      minSamples: MIN_SAMPLES,
    },
  }
}

function trend(
  hours: Hour[],
  values: Array<number | null>,
  ref: { edges: number[] } | null,
): InputTrendSeries {
  const lo = ref?.edges[0] ?? -Infinity
  const hi = ref?.edges[ref.edges.length - 1] ?? Infinity
  const raw = hours
    .map(h => ({ start: h.start, v: values[h.index] ?? null }))
    .filter((r): r is { start: number; v: number } => r.v !== null)
  const out = (v: number) => (v < lo || v > hi ? 1 : 0)
  const windows = raw.map(r => ({
    windowStart: iso(r.start),
    windowEnd: iso(r.start + HOUR),
    n: 1,
    min: r.v,
    max: r.v,
    mean: r.v,
    below: r.v < lo ? 1 : 0,
    above: r.v > hi ? 1 : 0,
  }))
  const bucketHours = Math.ceil(raw.length / TREND_MAX_POINTS)
  const points =
    bucketHours <= 1
      ? raw.map(r => ({
          t: iso(r.start),
          value: r.v,
          min: r.v,
          max: r.v,
          outOfRange: out(r.v),
        }))
      : Array.from({ length: Math.ceil(raw.length / bucketHours) }, (_, b) => {
          const vs = raw
            .slice(b * bucketHours, (b + 1) * bucketHours)
            .map(s => s.v)
          return {
            t: iso(raw[b * bucketHours]!.start),
            value: round(vs.reduce((a, c) => a + c, 0) / vs.length),
            min: Math.min(...vs),
            max: Math.max(...vs),
            outOfRange: vs.reduce((a, c) => a + out(c), 0),
          }
        })
  const vs = raw.map(r => r.v)
  const lastOut = [...raw].reverse().find(r => out(r.v) === 1)
  return {
    resolution: bucketHours <= 1 ? 'raw' : 'bucketed',
    bucketMinutes: bucketHours <= 1 ? null : bucketHours * 60,
    points,
    windows,
    liveMin: vs.length ? Math.min(...vs) : null,
    liveMax: vs.length ? Math.max(...vs) : null,
    liveMean: vs.length
      ? round(vs.reduce((a, c) => a + c, 0) / vs.length)
      : null,
    lastOutOfRangeAt: lastOut ? iso(lastOut.start) : null,
  }
}

export function inputDrift(
  fixture: MonitoringFixture,
  model: MockupModel,
  fromIso: string,
  toIso: string,
  now: number,
): InputDriftReport {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  const shift = shiftMsFor(fixture, now)
  const hours = hoursIn(fixture, shift, from, to)
  const columns: ColumnRangeDrift[] = []
  const series: Record<string, InputTrendSeries> = {}
  for (const column of fixture.featureColumns) {
    const all = fixture.features[column] ?? []
    const ref = fixture.ref[column] ?? null
    const values = hours
      .map(h => all[h.index] ?? null)
      .filter((v): v is number => v !== null)
    columns.push(columnDrift(column, values, ref))
    series[column] = trend(hours, all, ref)
  }
  const labValues = pairsIn(fixture, shift, from, to).map(p => p.actual)
  const target =
    fixture.targetRef.edges && fixture.targetRef.edges.length >= 2
      ? columnDrift(fixture.target, labValues, {
          edges: fixture.targetRef.edges,
          counts: fixture.targetRef.counts,
        })
      : null
  const graded = columns.filter(c => RANK[c.status] > 0)
  const status: InputDriftStatus =
    graded.length === 0
      ? 'UNKNOWN'
      : graded.reduce<InputDriftStatus>(
          (acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc),
          'OK',
        )
  return {
    status,
    columns,
    targetColumn: fixture.target,
    target,
    series,
    basis: {
      plane: 'window',
      modelVersionId: model.modelVersionId,
      version: model.version,
      from: fromIso,
      to: toIso,
      windowsUsed: hours.length,
      capped: false,
      maxDays: 31,
      truncated: false,
      missing: 0,
      healthWindows: HEALTH_WINDOWS,
      thresholds: {
        outOfRangeWarnPct: WARN_PCT,
        outOfRangeCriticalPct: CRITICAL_PCT,
        minSamples: MIN_SAMPLES,
      },
    },
  }
}

// ── inference status (deploy + health badges) ───────────────────────────

export function inferenceStatus(
  fixture: MonitoringFixture,
  model: MockupModel,
  now: number,
): InferenceStatus {
  const shift = shiftMsFor(fixture, now)
  const lastEnd = Date.parse(fixture.hours.at(-1)!) + shift + HOUR
  const pairs = pairsIn(fixture, shift, -Infinity, Infinity)
  const metrics = errorMetrics(pairs)
  const ratio = metrics ? round(metrics.sd / model.baselineSd, 3) : null
  const sdStatus =
    ratio === null || pairs.length < 2
      ? 'UNKNOWN'
      : ratio >= CRITICAL_SD
        ? 'ALERT'
        : ratio >= WARN_SD
          ? 'WARN'
          : 'OK'
  const drift = inputDrift(
    fixture,
    model,
    iso(lastEnd - HEALTH_WINDOWS * HOUR),
    iso(lastEnd),
    now,
  ).status
  const status =
    drift === 'CRITICAL' || sdStatus === 'ALERT'
      ? 'ALERT'
      : drift === 'WARN' || sdStatus === 'WARN'
        ? 'WARN'
        : 'OK'
  const reason =
    drift === 'CRITICAL'
      ? 'DRIFT_CRITICAL'
      : sdStatus === 'ALERT'
        ? 'RESIDUAL_SD_CRITICAL'
        : drift === 'WARN'
          ? 'DRIFT_WARN'
          : sdStatus === 'WARN'
            ? 'RESIDUAL_SD_WARN'
            : null
  return {
    enabled: true,
    cadenceMinutes: 60,
    lastSucceededAt: iso(lastEnd),
    lastTerminalAt: iso(lastEnd),
    gapCount: 0,
    staleness: 'OK',
    failing: false,
    lastFailure: null,
    lastSkipped: null,
    deployStatus: 'running',
    health: {
      status,
      reason,
      frozenColumns: [],
      residualSd: {
        status: sdStatus,
        liveSd: metrics?.sd ?? null,
        ratio,
        baselineSd: model.baselineSd,
        n: pairs.length,
      },
      frozenSince: [],
      thresholds: { warnSd: WARN_SD, criticalSd: CRITICAL_SD },
    },
  }
}

// ── routing ─────────────────────────────────────────────────────────────

/**
 * The mock answer for one API path under `/api/v1/authorized/model/{id}`,
 * or `undefined` to let the request reach the real backend.
 */
export function mockResponse(
  fixture: MonitoringFixture,
  model: MockupModel,
  url: URL,
  now: number,
): unknown {
  const prefix = `/api/v1/authorized/model/${model.modelId}/`
  const at = url.pathname.indexOf(prefix)
  if (at < 0) return undefined
  const path = url.pathname.slice(at + prefix.length)
  const fromIso = url.searchParams.get('from') ?? iso(now - 24 * HOUR)
  const toIso = url.searchParams.get('to') ?? iso(now)
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  switch (path) {
    case 'inference/status':
      return inferenceStatus(fixture, model, now)
    case 'inference/scheduled-series':
      return scheduledSeries(fixture, model, from, to, now)
    case 'inference/truth':
      return truth(fixture, model, from, to, now)
    case 'inference/manual-predictions':
      return { points: [] }
    case 'predictions':
      return { points: [], truncated: false, livePredictEnabled: false }
    case 'input-drift':
      return inputDrift(fixture, model, fromIso, toIso, now)
    default:
      return undefined
  }
}
