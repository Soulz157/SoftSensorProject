/**
 * Data-science preprocessing pipeline over mock PI readings.
 *
 * Pure module — no React, no IO. Builds a wide dataset (rows × tag columns)
 * from `lib/mock-readings.ts`, then transforms it through the
 * Raw → Preprocessing → Model-Ready stages and exposes chart/scatter adapters
 * plus an OLS linear-regression helper.
 */
import {
  generateReadings,
  tagMeta,
  type SensorQuality,
  type TimeRange,
} from '@/lib/mock-readings'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'

export interface Cell {
  value: number
  status: SensorQuality
}

export interface DataRow {
  timestamp: string
  cells: Record<string, Cell>
}

export interface Dataset {
  tags: string[]
  rows: DataRow[]
}

export interface DatasetStats {
  rawRows: number
  badRows: number
  questionableCells: number
  keptRows: number
  droppedRows: number
  features: number
  droppedRowsByTag: Record<string, number>
}

/** Per-tag fill rule for Step 6 (Data Processing). */
export type FillStrategy =
  | 'drop'
  | 'forward'
  | 'backward'
  | 'mean'
  | 'median'
  | 'constant'

export interface FillStrategyConfig {
  strategy: FillStrategy
  /** Required when `strategy === 'constant'`. */
  constantValue?: number
}

/**
 * One channel is a near-linear function of another so the scatter view has a
 * genuine correlation to fit (otherwise independent sines → R² ≈ 0).
 * Pressure (PI-303) ≈ intercept + slope · Temperature (TI-101) + ε.
 */
export const CORRELATED_PAIR = {
  anchor: 'TI-101',
  derived: 'PI-303',
  slope: 0.082,
  intercept: 2.24,
  noise: 0.15,
} as const

const SMOOTH_WINDOW = 3

/** Deterministic noise in [-0.5, 0.5) for a seed. */
function noise01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000 - 0.5
}

function cloneRows(rows: DataRow[]): DataRow[] {
  return rows.map(r => ({
    timestamp: r.timestamp,
    cells: Object.fromEntries(
      Object.entries(r.cells).map(([k, v]) => [k, { ...v }]),
    ),
  }))
}

function roundTo(value: number, precision: number): number {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

/** Stage 1 — raw dataset merged by a shared `now`, with the correlated pair. */
export function buildRawDataset(
  tags: string[],
  range: TimeRange,
  now: number = Date.now(),
): Dataset {
  const perTag = tags.map(tag => ({
    tag,
    readings: generateReadings(tag, range, now),
  }))

  const byTs = new Map<string, DataRow>()
  for (const { tag, readings } of perTag) {
    for (const r of readings) {
      const row = byTs.get(r.timestamp) ?? { timestamp: r.timestamp, cells: {} }
      row.cells[tag] = { value: r.value, status: r.status }
      byTs.set(r.timestamp, row)
    }
  }
  const rows = Array.from(byTs.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : 1,
  )

  // Correlated-pair override: derived := intercept + slope·anchor + ε.
  const { anchor, derived, slope, intercept, noise } = CORRELATED_PAIR
  if (tags.includes(anchor) && tags.includes(derived)) {
    const precision = tagMeta(derived)?.precision ?? 2
    for (const row of rows) {
      const a = row.cells[anchor]
      const d = row.cells[derived]
      if (a && d) {
        const eps = noise01(`c:${derived}:${row.timestamp}`) * 2 * noise
        d.value = roundTo(intercept + slope * a.value + eps, precision)
      }
    }
  }

  return { tags, rows }
}

/** Fill a single tag's Bad/Questionable cells in place per its strategy. */
function applyFillStrategy(
  rows: DataRow[],
  tag: string,
  config: FillStrategyConfig,
): void {
  const goodValues = rows
    .map(r => r.cells[tag])
    .filter((c): c is Cell => !!c && c.status === 'Good')
    .map(c => c.value)

  let fillValue: number | undefined
  if (config.strategy === 'mean' && goodValues.length > 0) {
    fillValue = goodValues.reduce((a, b) => a + b, 0) / goodValues.length
  } else if (config.strategy === 'median' && goodValues.length > 0) {
    const sorted = [...goodValues].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    fillValue =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid]
  } else if (config.strategy === 'constant') {
    fillValue = config.constantValue ?? 0
  }

  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i]?.cells[tag]
    if (!cell || cell.status === 'Good') continue

    if (config.strategy === 'forward') {
      let p = i - 1
      while (p >= 0 && rows[p]?.cells[tag]?.status !== 'Good') p--
      const prev = p >= 0 ? rows[p]?.cells[tag] : undefined
      if (prev) cell.value = prev.value
    } else if (config.strategy === 'backward') {
      let n = i + 1
      while (n < rows.length && rows[n]?.cells[tag]?.status !== 'Good') n++
      const next = n < rows.length ? rows[n]?.cells[tag] : undefined
      if (next) cell.value = next.value
    } else if (fillValue !== undefined) {
      cell.value = fillValue
    }
    cell.status = 'Good'
  }
}

/**
 * Stage 2 — apply per-tag processing rules.
 *
 * Tags with no entry in `strategies` (or explicit `'drop'`) keep the original
 * behaviour: contribute to a global Bad-row drop, then get Questionable cells
 * linear-interpolated, then moving-average smoothed. Tags with an explicit
 * cell-level strategy (`forward`/`backward`/`mean`/`median`/`constant`) get
 * their Bad/Questionable cells filled first so they never cause a row to be
 * dropped, and are left as-is afterward (no smoothing — the chosen fill value
 * should stand). Passing `strategies = {}` reproduces the exact prior output.
 */
export function preprocess(
  raw: Dataset,
  strategies: Record<string, FillStrategyConfig> = {},
): Dataset {
  const { tags } = raw
  const rows = cloneRows(raw.rows)

  const dropTags = tags.filter(
    t => (strategies[t]?.strategy ?? 'drop') === 'drop',
  )
  const fillTags = tags.filter(
    t => strategies[t] && strategies[t]?.strategy !== 'drop',
  )

  // 1. Cell-level fill for opted-in tags — keeps their rows out of the drop.
  for (const t of fillTags) {
    const config = strategies[t]
    if (config) applyFillStrategy(rows, t, config)
  }

  // 2. Drop rows where any drop-semantics tag is Bad (preserves old global rule).
  const kept = rows.filter(
    row => !dropTags.some(t => row.cells[t]?.status === 'Bad'),
  )

  // 3. Linear-interpolate Questionable cells for drop-semantics tags.
  for (const t of dropTags) {
    for (let i = 0; i < kept.length; i++) {
      const cell = kept[i]?.cells[t]
      if (!cell || cell.status !== 'Questionable') continue

      let p = i - 1
      while (p >= 0 && kept[p]?.cells[t]?.status !== 'Good') p--
      let n = i + 1
      while (n < kept.length && kept[n]?.cells[t]?.status !== 'Good') n++

      const prev = p >= 0 ? kept[p]?.cells[t] : undefined
      const next = n < kept.length ? kept[n]?.cells[t] : undefined
      if (prev && next) {
        const ratio = (i - p) / (n - p)
        cell.value = prev.value + (next.value - prev.value) * ratio
      } else if (prev) {
        cell.value = prev.value
      } else if (next) {
        cell.value = next.value
      }
      cell.status = 'Good'
    }
  }

  // 4. Moving-average smoothing for drop-semantics tags only.
  for (const t of dropTags) {
    const precision = tagMeta(t)?.precision ?? 2
    const values = kept.map(r => r.cells[t]?.value ?? 0)
    const half = Math.floor(SMOOTH_WINDOW / 2)
    kept.forEach((row, i) => {
      const cell = row.cells[t]
      if (!cell) return
      const lo = Math.max(0, i - half)
      const hi = Math.min(values.length - 1, i + half)
      let sum = 0
      for (let k = lo; k <= hi; k++) sum += values[k] ?? 0
      cell.value = roundTo(sum / (hi - lo + 1), precision)
      cell.status = 'Good'
    })
  }

  return { tags, rows: kept }
}

/** Stage 3 — min-max normalize each column to [0, 1]. */
export function toModelReady(clean: Dataset): Dataset {
  const { tags } = clean
  const rows = cloneRows(clean.rows)

  for (const t of tags) {
    const values = rows.map(r => r.cells[t]?.value ?? 0)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min
    rows.forEach(row => {
      const cell = row.cells[t]
      if (!cell) return
      cell.value = span === 0 ? 0 : roundTo((cell.value - min) / span, 3)
      cell.status = 'Good'
    })
  }

  return { tags, rows }
}

export function datasetStats(
  raw: Dataset,
  clean: Dataset,
  model: Dataset,
  strategies: Record<string, FillStrategyConfig> = {},
): DatasetStats {
  const { tags } = raw
  const badRows = raw.rows.filter(r =>
    tags.some(t => r.cells[t]?.status === 'Bad'),
  ).length
  let questionableCells = 0
  for (const r of raw.rows) {
    for (const t of tags) {
      if (r.cells[t]?.status === 'Questionable') questionableCells++
    }
  }

  // Attribute each dropped row (present in raw, absent in clean) to whichever
  // drop-semantics tag(s) were Bad — mirrors `preprocess`'s drop rule exactly.
  const dropTags = tags.filter(
    t => (strategies[t]?.strategy ?? 'drop') === 'drop',
  )
  const cleanTimestamps = new Set(clean.rows.map(r => r.timestamp))
  const droppedRowsByTag: Record<string, number> = {}
  for (const r of raw.rows) {
    if (cleanTimestamps.has(r.timestamp)) continue
    for (const t of dropTags) {
      if (r.cells[t]?.status === 'Bad') {
        droppedRowsByTag[t] = (droppedRowsByTag[t] ?? 0) + 1
      }
    }
  }

  return {
    rawRows: raw.rows.length,
    badRows,
    questionableCells,
    keptRows: clean.rows.length,
    droppedRows: raw.rows.length - clean.rows.length,
    features: model.tags.length,
    droppedRowsByTag,
  }
}

/** Wide rows for the time-series chart (`sensor-trend-chart`). */
export function toChartRows(ds: Dataset): SensorChartRow[] {
  return ds.rows.map(r => {
    const row: SensorChartRow = { timestamp: r.timestamp }
    for (const t of ds.tags) {
      const cell = r.cells[t]
      if (cell) row[t] = cell.value
    }
    return row
  })
}

export interface ScatterPoint {
  x: number
  y: number
}

export function toScatterPoints(
  ds: Dataset,
  xTag: string,
  yTag: string,
): ScatterPoint[] {
  const points: ScatterPoint[] = []
  for (const r of ds.rows) {
    const x = r.cells[xTag]
    const y = r.cells[yTag]
    if (x && y) points.push({ x: x.value, y: y.value })
  }
  return points
}

export interface Regression {
  slope: number
  intercept: number
  r2: number
}

/** Ordinary least squares. */
export function linearRegression(points: ScatterPoint[]): Regression {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 }

  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const { x, y } of points) {
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
    syy += y * y
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 }

  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const r2Denom = denom * (n * syy - sy * sy)
  const r2 = r2Denom === 0 ? 0 : Math.pow(n * sxy - sx * sy, 2) / r2Denom
  return { slope, intercept, r2 }
}

/** Two endpoints spanning the data's x-range, for a regression ReferenceLine. */
export function regressionSegment(
  points: ScatterPoint[],
  slope: number,
  intercept: number,
): [ScatterPoint, ScatterPoint] {
  const xs = points.map(p => p.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  return [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept },
  ]
}
