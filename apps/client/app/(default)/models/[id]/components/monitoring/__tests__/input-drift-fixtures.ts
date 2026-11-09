import type {
  ColumnBins,
  ColumnRangeDrift,
  InputDriftReport,
  InputDriftStatus,
  InputDriftWindow,
  InputTrendPoint,
  InputTrendSeries,
} from '@/services/model-monitoring'

/**
 * MODEL-SERVE-036 test fixtures — synthetic data shaped exactly like the
 * `/input-drift` response, modelled on model TM (85b35299)'s tags. First
 * built for the design mockup the user approved on 2026-10-19.
 */

const THRESHOLDS = {
  outOfRangeWarnPct: 5,
  outOfRangeCriticalPct: 20,
  minSamples: 30,
}
const HEALTH_WINDOWS = 24
const BIN_COUNT = 10

/** Deterministic PRNG so the mockup renders the same every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface TagSpec {
  column: string
  trainMin: number | null
  trainMax: number | null
  binMode: 'continuous' | 'categorical'
  /** Live value generator, minute index -> value. */
  value: (i: number, r: () => number) => number
  /** Only the newest N minutes carry values (INSUFFICIENT_DATA demo). */
  onlyLastMinutes?: number
}

const TAGS: TagSpec[] = [
  {
    // Every live value above the training max — the real state of
    // AI206.PV in window histograms (above: 60, counts all 0).
    column: 'AI206.PV',
    trainMin: 0.82,
    trainMax: 4.2,
    binMode: 'continuous',
    value: (i, r) => 4.75 + 0.18 * Math.sin(i / 90) + (r() - 0.5) * 0.08,
  },
  {
    // Mostly inside with afternoon excursions above max -> WARN.
    column: 'TI202.PV',
    trainMin: 148.5,
    trainMax: 171.2,
    binMode: 'continuous',
    value: (i, r) => {
      const hour = Math.floor(i / 60) % 24
      const spike = hour === 14 || hour === 15 ? 6.5 : 0
      return 160 + 6.5 * Math.sin(i / 200) + spike + (r() - 0.5) * 2.5
    },
  },
  {
    column: 'FI001.PV',
    trainMin: 220,
    trainMax: 410,
    binMode: 'continuous',
    value: (i, r) => 315 + 40 * Math.sin(i / 300) + (r() - 0.5) * 12,
  },
  {
    column: 'FIC204.PV',
    trainMin: 12.4,
    trainMax: 38.9,
    binMode: 'continuous',
    value: (i, r) => 27 + 3 * Math.sin(i / 120) + (r() - 0.5) * 1.5,
  },
  {
    // Hugging the training min, a few dips below -> low out-of-range %.
    column: 'TI207.PV',
    trainMin: 61.3,
    trainMax: 88.7,
    binMode: 'continuous',
    value: (i, r) => 62.4 + 0.9 * Math.sin(i / 70) + (r() - 0.5) * 0.9,
  },
  {
    // A three-position valve; state 3 was never seen in training.
    column: 'FIC107R.PV',
    trainMin: 0,
    trainMax: 2,
    binMode: 'categorical',
    value: (i, r) => {
      const v = r()
      if (Math.floor(i / 60) % 24 === 9) return 3
      return v < 0.6 ? 1 : v < 0.85 ? 2 : 0
    },
  },
  {
    column: 'FY107.CPV',
    trainMin: 0.0011,
    trainMax: 0.0049,
    binMode: 'continuous',
    value: (i, r) => 0.003 + 0.0006 * Math.sin(i / 40) + (r() - 0.5) * 0.0002,
    onlyLastMinutes: 12,
  },
  {
    // A spec with no psiRefEdges for this tag -> UNKNOWN, no range lines.
    column: 'AI001B2.PV',
    trainMin: null,
    trainMax: null,
    binMode: 'continuous',
    value: (i, r) => 7.1 + 0.4 * Math.sin(i / 150) + (r() - 0.5) * 0.2,
  },
]

const TARGET: TagSpec = {
  column: 'AI001A2.PV',
  trainMin: 0.9,
  trainMax: 1.95,
  binMode: 'continuous',
  value: (i, r) => 1.42 + 0.12 * Math.sin(i / 400) + (r() - 0.5) * 0.04,
}

function statusFor(
  liveTotal: number,
  pct: number | null,
  hasRange: boolean,
): InputDriftStatus {
  if (!hasRange) return 'UNKNOWN'
  if (liveTotal < THRESHOLDS.minSamples || pct === null)
    return 'INSUFFICIENT_DATA'
  if (pct >= THRESHOLDS.outOfRangeCriticalPct) return 'CRITICAL'
  if (pct >= THRESHOLDS.outOfRangeWarnPct) return 'WARN'
  return 'OK'
}

function binsFor(
  spec: TagSpec,
  values: number[],
  below: number,
  above: number,
): ColumnBins | null {
  if (spec.trainMin === null || spec.trainMax === null) return null
  const { trainMin: lo, trainMax: hi } = spec
  if (spec.binMode === 'categorical') {
    const edges = [0, 1, 2]
    const liveCounts = edges.map(e => values.filter(v => v === e).length)
    return {
      binMode: 'categorical',
      binCount: edges.length,
      edges,
      refCounts: [310, 520, 170],
      liveCounts,
      below,
      above,
      liveInRangeTotal: liveCounts.reduce((a, b) => a + b, 0),
      minSamples: THRESHOLDS.minSamples,
    }
  }
  const edges = Array.from(
    { length: BIN_COUNT + 1 },
    (_, k) => lo + ((hi - lo) * k) / BIN_COUNT,
  )
  const liveCounts = new Array<number>(BIN_COUNT).fill(0)
  for (const v of values) {
    if (v < lo || v > hi) continue
    const k = Math.min(
      BIN_COUNT - 1,
      Math.floor(((v - lo) / (hi - lo)) * BIN_COUNT),
    )
    liveCounts[k] = (liveCounts[k] ?? 0) + 1
  }
  return {
    binMode: 'continuous',
    binCount: BIN_COUNT,
    edges,
    refCounts: new Array<number>(BIN_COUNT).fill(876),
    liveCounts,
    below,
    above,
    liveInRangeTotal: liveCounts.reduce((a, b) => a + b, 0),
    minSamples: THRESHOLDS.minSamples,
  }
}

interface Built {
  column: ColumnRangeDrift
  series: InputTrendSeries
}

function mean(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function build(
  spec: TagSpec,
  seed: number,
  endMs: number,
  minutes: number,
  bucketMinutes: number | null,
): Built {
  const r = rng(seed)
  const lo = spec.trainMin
  const hi = spec.trainMax
  const isBelow = (v: number) => lo !== null && v < lo
  const isAbove = (v: number) => hi !== null && v > hi
  const isOut = (v: number) => isBelow(v) || isAbove(v)

  const startMs = endMs - minutes * 60_000
  const firstLive = spec.onlyLastMinutes ? minutes - spec.onlyLastMinutes : 0
  const rows: { t: number; v: number }[] = []
  for (let i = firstLive; i < minutes; i++) {
    rows.push({ t: startMs + i * 60_000, v: spec.value(i, r) })
  }

  let below = 0
  let above = 0
  let lastOut: number | null = null
  for (const row of rows) {
    if (isBelow(row.v)) below++
    else if (isAbove(row.v)) above++
    if (isOut(row.v)) lastOut = row.t
  }

  // Windows: one per hour, newest first.
  const byHour = new Map<number, number[]>()
  for (const row of rows) {
    const h = Math.floor(row.t / 3_600_000) * 3_600_000
    const list = byHour.get(h) ?? []
    list.push(row.v)
    byHour.set(h, list)
  }
  const windows: InputDriftWindow[] = [...byHour.entries()]
    .map(([h, vals]) => ({
      windowStart: new Date(h).toISOString(),
      windowEnd: new Date(h + 3_600_000).toISOString(),
      n: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
      mean: mean(vals),
      below: vals.filter(isBelow).length,
      above: vals.filter(isAbove).length,
    }))
    .reverse()

  // Points: raw per minute, or bucketed keeping each bucket's min/max.
  const points: InputTrendPoint[] = []
  if (bucketMinutes === null) {
    for (const row of rows) {
      points.push({
        t: new Date(row.t).toISOString(),
        value: row.v,
        min: row.v,
        max: row.v,
        outOfRange: isOut(row.v) ? 1 : 0,
      })
    }
  } else {
    for (let i = 0; i < rows.length; i += bucketMinutes) {
      const chunk = rows.slice(i, i + bucketMinutes)
      const vals = chunk.map(c => c.v)
      points.push({
        t: new Date(chunk[0]!.t).toISOString(),
        value: mean(vals),
        min: Math.min(...vals),
        max: Math.max(...vals),
        outOfRange: vals.filter(isOut).length,
      })
    }
  }

  const values = rows.map(row => row.v)
  const liveTotal = values.length
  const hasRange = lo !== null && hi !== null
  const pct =
    hasRange && liveTotal > 0 ? ((below + above) / liveTotal) * 100 : null

  return {
    column: {
      column: spec.column,
      liveTotal,
      below,
      above,
      outOfRangePct: pct,
      trainMin: lo,
      trainMax: hi,
      binMode: hasRange ? spec.binMode : null,
      status: statusFor(liveTotal, pct, hasRange),
      reason: hasRange
        ? undefined
        : 'no training range recorded — retrain to enable',
      bins: binsFor(spec, values, below, above),
    },
    series: {
      resolution: bucketMinutes === null ? 'raw' : 'bucketed',
      bucketMinutes,
      points,
      windows,
      liveMin: values.length ? Math.min(...values) : null,
      liveMax: values.length ? Math.max(...values) : null,
      liveMean: values.length ? mean(values) : null,
      lastOutOfRangeAt:
        lastOut === null ? null : new Date(lastOut).toISOString(),
    },
  }
}

const SEVERITY: Record<InputDriftStatus, number> = {
  CRITICAL: 4,
  WARN: 3,
  OK: 2,
  INSUFFICIENT_DATA: 1,
  UNKNOWN: 0,
}

export type MockScenario = '24h' | '7d' | '1y' | 'empty'

const END = Date.parse('2026-10-19T08:00:00.000Z')

const PLANS: Record<
  MockScenario,
  { minutes: number; bucket: number | null; capped: boolean; days: number }
> = {
  '24h': { minutes: 24 * 60, bucket: null, capped: false, days: 1 },
  '7d': { minutes: 7 * 24 * 60, bucket: 15, capped: false, days: 7 },
  '1y': { minutes: 31 * 24 * 60, bucket: 60, capped: true, days: 31 },
  empty: { minutes: 0, bucket: null, capped: false, days: 1 },
}

export function mockReport(scenario: MockScenario): InputDriftReport {
  const plan = PLANS[scenario]
  const built = plan.minutes
    ? TAGS.map((t, i) => build(t, 11 + i, END, plan.minutes, plan.bucket))
    : []
  const target = plan.minutes
    ? build(TARGET, 99, END, plan.minutes, plan.bucket)
    : null
  const columns = built.map(b => b.column)
  const status = columns.reduce<InputDriftStatus>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'UNKNOWN',
  )
  const series: Record<string, InputTrendSeries> = {}
  for (const b of built) series[b.column.column] = b.series
  if (target) series[target.column.column] = target.series

  return {
    status,
    columns,
    targetColumn: TARGET.column,
    target: target?.column ?? null,
    series,
    basis: {
      plane: 'window',
      modelVersionId: '85b35299-mock-version',
      version: 3,
      from: new Date(END - plan.days * 86_400_000).toISOString(),
      to: new Date(END).toISOString(),
      windowsUsed: Math.round(plan.minutes / 60),
      capped: plan.capped,
      maxDays: 31,
      truncated: false,
      missing: scenario === '7d' ? 2 : 0,
      healthWindows: HEALTH_WINDOWS,
      thresholds: THRESHOLDS,
    },
  }
}
