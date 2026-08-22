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
  rangeTimestamps,
  tagMeta,
  type SensorQuality,
  type TimeRange,
} from '@/lib/mock-readings'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'

export interface Cell {
  value: number
  status: SensorQuality
  clipped?: boolean
}

export interface DataRow {
  timestamp: string
  cells: Record<string, Cell>
}

export interface Dataset {
  tags: string[]
  rows: DataRow[]
}

/**
 * A `Dataset` that provably came from ONE bounded server page, not an
 * accumulate-everything loop (DS-LAKE-005B-B-T04, given a real call site by
 * T01's fetchVersionRowsPage in services/dataset-version.ts).
 *
 * The brand is a private, non-exported symbol — a plain `Dataset` cannot be
 * assigned where a `BoundedSample` is expected without going through
 * `brandBoundedSample()`, which only legitimate server-page readers should
 * call. This is what turns "handed the full frame where a bounded page was
 * expected" from a convention into a compile error, per V03's own wording:
 * "a boundary that only holds while everyone remembers it is not a
 * boundary."
 *
 * Deliberately does NOT gate `precleanse`/`applyValueClip` — those two are
 * out of scope for this task (DS-LAKE-005B-B-T01's blockedReason and the
 * feature's own dependency_correction record exactly why: DataAnalysisCard
 * and Step 5 have no safe server-side replacement yet). Retyping their
 * signatures to accept `BoundedSample` is the rest of T04, once a real
 * consumer exists for THAT boundary too.
 */
declare const boundedSampleBrand: unique symbol
export type BoundedSample = Dataset & { readonly [boundedSampleBrand]: true }

/** The one legitimate way to mint a `BoundedSample` — from a real page. */
export function brandBoundedSample(page: Dataset): BoundedSample {
  return page as BoundedSample
}

/**
 * Split a dataset's columns into numeric vs categorical groups. There is no
 * categorical dtype in the data model yet (`Cell.value` is always `number`),
 * so every tag is numeric today — the single place to add a real data-driven
 * classifier later. Consumers should render a Categorical group only when it
 * is non-empty.
 */
export function classifyColumns(dataset: Dataset): {
  numeric: string[]
  categorical: string[]
} {
  return { numeric: dataset.tags, categorical: [] }
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

/** Per-column scaling applied at the model-ready stage. */
export type ScalerMethod = 'minmax' | 'standard' | 'robust' | 'none'

export const DEFAULT_SCALER: ScalerMethod = 'minmax'

export const CORRELATED_PAIR = {
  anchor: 'TI-101',
  derived: 'PI-303',
  slope: 0.082,
  intercept: 2.24,
  noise: 0.15,
} as const

const SMOOTH_WINDOW = 3

function noise01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000 - 0.5
}

export function cloneRow(r: DataRow): DataRow {
  const cells: Record<string, Cell> = {}
  for (const key in r.cells) cells[key] = { ...r.cells[key]! }
  return { timestamp: r.timestamp, cells }
}

export function cloneRows(rows: DataRow[]): DataRow[] {
  const out = new Array<DataRow>(rows.length)
  for (let i = 0; i < rows.length; i++) out[i] = cloneRow(rows[i]!)
  return out
}

function roundTo(value: number, precision: number): number {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function goodValuesOf(rows: DataRow[], tag: string): number[] {
  const out: number[] = []
  for (const r of rows) {
    const c = r.cells[tag]
    if (c && c.status === 'Good') out.push(c.value)
  }
  return out
}

export function buildRawDataset(
  tags: string[],
  range: TimeRange,
  now: number = Date.now(),
  constants: Record<string, number> = {},
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

  const constantEntries = Object.entries(constants).filter(([tag]) =>
    tags.includes(tag),
  )
  if (constantEntries.length > 0) {
    for (const ts of rangeTimestamps(range, now)) {
      if (!byTs.has(ts)) byTs.set(ts, { timestamp: ts, cells: {} })
    }
  }

  const rows = Array.from(byTs.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : 1,
  )

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

  if (constantEntries.length > 0) {
    for (const row of rows) {
      for (const [tag, value] of constantEntries) {
        row.cells[tag] = { value, status: 'Good' }
      }
    }
  }

  return { tags, rows }
}

function applyFillStrategy(
  rows: DataRow[],
  tag: string,
  config: FillStrategyConfig,
): void {
  const needsValues = config.strategy === 'mean' || config.strategy === 'median'
  const goodValues = needsValues ? goodValuesOf(rows, tag) : []

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

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step cleaning pipeline (Step 3.2 bulk cleaning)
//
// A per-tag ORDERED list of steps applied in sequence over the wide dataset.
// Additive engine that shares the same primitives as `preprocess`
// (`applyFillStrategy`, `median`, `roundTo`); the legacy `preprocess(strategies)`
// above stays intact for the data-visualize wizard.
// ─────────────────────────────────────────────────────────────────────────────

export type CleaningCategory = 'missing' | 'outliers' | 'smoothing'

export type CleaningMethod =
  // missing
  | 'drop'
  | 'mean'
  | 'median'
  | 'constant'
  | 'forward'
  | 'backward'
  | 'interpolate'
  // outliers
  | 'zscore'
  | 'clip'
  | 'crop'
  | 'exclude'
  | 'outlier_median'
  // smoothing
  | 'moving_avg'
  | 'exponential'

export interface CleaningStep {
  uid: string
  category: CleaningCategory
  method: CleaningMethod
  /** window (moving_avg) · alpha (exponential) · z-threshold · constant · clip/crop/exclude high */
  param?: number
  /** clip/crop/exclude low bound only */
  paramLow?: number
}

export type TagPipeline = CleaningStep[]

/** The missing-fill methods that map onto the shared `FillStrategyConfig`. */
const FILL_METHODS: Partial<Record<CleaningMethod, FillStrategy>> = {
  mean: 'mean',
  median: 'median',
  constant: 'constant',
  forward: 'forward',
  backward: 'backward',
}

/** Linear-interpolate every non-Good cell for a tag; flips them to Good. */
function interpolateTag(rows: DataRow[], tag: string): void {
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i]?.cells[tag]
    if (!cell || cell.status === 'Good') continue

    let p = i - 1
    while (p >= 0 && rows[p]?.cells[tag]?.status !== 'Good') p--
    let n = i + 1
    while (n < rows.length && rows[n]?.cells[tag]?.status !== 'Good') n++

    const prev = p >= 0 ? rows[p]?.cells[tag] : undefined
    const next = n < rows.length ? rows[n]?.cells[tag] : undefined
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

/** Apply one cleaning step to a single tag in place; `drop` steps mark rows. */
function applyCleaningStep(
  rows: DataRow[],
  tag: string,
  step: CleaningStep,
  dropRows: Set<number>,
  precision: number,
): void {
  const { method } = step

  // ── missing ──
  if (method === 'drop') {
    for (let i = 0; i < rows.length; i++) {
      const cell = rows[i]?.cells[tag]
      if (cell && cell.status !== 'Good') dropRows.add(i)
    }
    return
  }
  if (method === 'interpolate') {
    interpolateTag(rows, tag)
    return
  }
  const fill = FILL_METHODS[method]
  if (fill) {
    applyFillStrategy(rows, tag, { strategy: fill, constantValue: step.param })
    return
  }

  // ── outliers ──
  if (method === 'zscore') {
    const threshold = step.param ?? 3
    const vals = goodValuesOf(rows, tag)
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    const variance = vals.length
      ? vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length
      : 0
    const std = Math.sqrt(variance)
    if (std === 0) return
    for (const row of rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      if (Math.abs((cell.value - mean) / std) > threshold) {
        cell.value = roundTo(mean, precision)
        cell.status = 'Good'
      }
    }
    return
  }
  if (method === 'clip') {
    const low = step.paramLow
    const high = step.param
    for (const row of rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      if (low !== undefined && cell.value < low) cell.value = low
      if (high !== undefined && cell.value > high) cell.value = high
    }
    return
  }
  // Value-axis counterparts of the cropping chart's `crop`/`exclude` drag
  // modes, sharing the Min/Max params `clip` already uses. The trio differs
  // only in what it does to a matched reading: `clip` clamps it to the bound,
  // `crop` KEEPS the band and drops the rows outside it, `exclude` keeps
  // everything outside and marks what is inside Bad.
  //
  // Both are a deliberate no-op while neither bound is set, the same guard
  // `clip` documents: an unbounded `crop` would drop every row and an
  // unbounded `exclude` would mark the whole tag Bad, so adding the step
  // before typing a bound must change nothing.
  if (method === 'crop') {
    const low = step.paramLow
    const high = step.param
    if (low === undefined && high === undefined) return
    for (let i = 0; i < rows.length; i++) {
      const cell = rows[i]?.cells[tag]
      if (!cell) continue
      const outside =
        (low !== undefined && cell.value < low) ||
        (high !== undefined && cell.value > high)
      // Row-level, like `drop` — the union across tags is removed once at the
      // end of preprocessPipelines, so cropping one tag trims that timestamp
      // for the others too. That is the same trade `drop` already makes.
      if (outside) dropRows.add(i)
    }
    return
  }
  if (method === 'exclude') {
    const low = step.paramLow
    const high = step.param
    if (low === undefined && high === undefined) return
    for (const row of rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      const inside =
        (low === undefined || cell.value >= low) &&
        (high === undefined || cell.value <= high)
      // Marked Bad rather than dropped: null-equivalent, so a later fill step
      // in the same pipeline can impute it, and only THIS tag is affected —
      // dropping the row would delete the timestamp for every other tag.
      if (inside) cell.status = 'Bad'
    }
    return
  }
  if (method === 'outlier_median') {
    const sorted: number[] = []
    for (const r of rows) {
      const c = r.cells[tag]
      if (c) sorted.push(c.value)
    }
    if (sorted.length === 0) return
    sorted.sort((a, b) => a - b)
    const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0
    const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0
    const iqr = q3 - q1
    const med = median(sorted)
    const lo = q1 - 1.5 * iqr
    const hi = q3 + 1.5 * iqr
    for (const row of rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      if (cell.value < lo || cell.value > hi) {
        cell.value = roundTo(med, precision)
      }
    }
    return
  }

  // ── smoothing ──
  if (method === 'moving_avg') {
    const window = Math.max(1, Math.round(step.param ?? SMOOTH_WINDOW))
    const half = Math.floor(window / 2)
    const values = rows.map(r => r.cells[tag]?.value ?? 0)
    rows.forEach((row, i) => {
      const cell = row.cells[tag]
      if (!cell) return
      const lo = Math.max(0, i - half)
      const hi = Math.min(values.length - 1, i + half)
      let sum = 0
      for (let k = lo; k <= hi; k++) sum += values[k] ?? 0
      cell.value = roundTo(sum / (hi - lo + 1), precision)
    })
    return
  }
  if (method === 'exponential') {
    const alpha = Math.min(1, Math.max(0, step.param ?? 0.3))
    let ema: number | undefined
    for (const row of rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      ema =
        ema === undefined ? cell.value : alpha * cell.value + (1 - alpha) * ema
      cell.value = roundTo(ema, precision)
    }
    return
  }
}

/**
 * Stage 2 (bulk) — run an ordered multi-step cleaning pipeline per tag over the
 * wide dataset. Steps run in listed order (missing → outliers → smoothing is
 * the natural authoring order, but any order is honored). `drop` steps mark
 * rows whose cell is Bad/Questionable; the union across all tags is removed
 * once at the end. Tags with no pipeline pass through untouched.
 */
export function preprocessPipelines(
  raw: Dataset,
  pipelines: Record<string, TagPipeline>,
): Dataset {
  const { tags } = raw
  const active = tags.filter(t => (pipelines[t]?.length ?? 0) > 0)
  if (active.length === 0) return { tags, rows: raw.rows }

  const rows = cloneRows(raw.rows)
  const dropRows = new Set<number>()

  for (const tag of active) {
    const steps = pipelines[tag]!
    const precision = tagMeta(tag)?.precision ?? 2
    for (const step of steps) {
      applyCleaningStep(rows, tag, step, dropRows, precision)
    }
  }

  const kept =
    dropRows.size === 0 ? rows : rows.filter((_, i) => !dropRows.has(i))
  return { tags, rows: kept }
}

function median(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  const hi = sorted[mid] ?? 0
  return n % 2 === 0 ? ((sorted[mid - 1] ?? 0) + hi) / 2 : hi
}

function medianRange(arr: number[], start: number, end: number): number {
  const n = end - start
  if (n <= 0) return 0
  const mid = start + (n >> 1)
  const hi = arr[mid] ?? 0
  return n % 2 === 0 ? ((arr[mid - 1] ?? 0) + hi) / 2 : hi
}

function scaleColumn(values: number[], method: ScalerMethod): number[] {
  if (method === 'none') return values.map(v => roundTo(v, 3))

  if (method === 'minmax') {
    const min = Math.min(...values)
    const span = Math.max(...values) - min
    return values.map(v => (span === 0 ? 0 : roundTo((v - min) / span, 3)))
  }

  if (method === 'standard') {
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1)
    const variance =
      values.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
      (values.length || 1)
    const std = Math.sqrt(variance)
    return values.map(v => (std === 0 ? 0 : roundTo((v - mean) / std, 3)))
  }

  // robust — center on median, scale by IQR (Q3 − Q1).
  const sorted = [...values].sort((a, b) => a - b)
  const med = median(sorted)
  const lower = sorted.slice(0, Math.floor(sorted.length / 2))
  const upper = sorted.slice(Math.ceil(sorted.length / 2))
  const iqr = median(upper) - median(lower)
  return values.map(v => (iqr === 0 ? 0 : roundTo((v - med) / iqr, 3)))
}

/**
 * Stage 3 — model-ready scaling. Each column is scaled independently by
 * `scalers[tag]`, defaulting to `minmax` (the historical behavior) when a tag
 * has no entry, so callers passing no `scalers` get min-max normalization.
 */
export function toModelReady(
  clean: Dataset,
  scalers: Record<string, ScalerMethod> = {},
): Dataset {
  const { tags } = clean
  const rows = cloneRows(clean.rows)

  // Allocated at most once per call, reused by every robust-scaled column.
  let sortBuf: number[] | null = null

  for (const t of tags) {
    const method = scalers[t] ?? DEFAULT_SCALER

    if (method === 'none') {
      for (const row of rows) {
        const c = row.cells[t]
        if (!c) continue
        c.value = roundTo(c.value, 3)
        c.status = 'Good'
      }
      continue
    }

    if (method === 'minmax') {
      let lo = Infinity
      let hi = -Infinity
      for (const row of rows) {
        const v = row.cells[t]?.value
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      const span = lo === Infinity ? 0 : hi - lo
      for (const row of rows) {
        const c = row.cells[t]
        if (!c) continue
        c.value = span === 0 ? 0 : roundTo((c.value - lo) / span, 3)
        c.status = 'Good'
      }
      continue
    }

    if (method === 'standard') {
      // Welford instead of E[x²] − E[x]²: plant tags whose absolute value
      // dwarfs their spread (a temperature at 800 K with std 0.5) lose most of
      // their significant digits in the naive form.
      let n = 0
      let mean = 0
      let m2 = 0
      for (const row of rows) {
        const v = row.cells[t]?.value
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        n++
        const d = v - mean
        mean += d / n
        m2 += d * (v - mean)
      }
      const std = n > 0 ? Math.sqrt(m2 / n) : 0
      for (const row of rows) {
        const c = row.cells[t]
        if (!c) continue
        c.value = std === 0 ? 0 : roundTo((c.value - mean) / std, 3)
        c.status = 'Good'
      }
      continue
    }

    sortBuf ??= new Array<number>(rows.length)
    let k = 0
    for (const row of rows) {
      const v = row.cells[t]?.value
      if (typeof v === 'number' && Number.isFinite(v)) sortBuf[k++] = v
    }
    if (k === 0) continue
    const buf = sortBuf
    buf.length = k
    buf.sort((a, b) => a - b)

    const med = medianRange(buf, 0, k)
    const iqr =
      medianRange(buf, Math.ceil(k / 2), k) -
      medianRange(buf, 0, Math.floor(k / 2))

    for (const row of rows) {
      const c = row.cells[t]
      if (!c) continue
      c.value = iqr === 0 ? 0 : roundTo((c.value - med) / iqr, 3)
      c.status = 'Good'
    }
    sortBuf.length = rows.length
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

export interface TagFillPreviewRow {
  timestamp: string
  before: number | null
  after: number | null
}

/**
 * Join `base` (pre-fill) and `filled` (post-`preprocess`) by timestamp for a
 * single tag, for before/after preview charts. Joins by timestamp rather than
 * index since `filled` may have fewer rows (a drop-semantics tag can remove
 * rows that `base` still has).
 */
export function tagFillPreview(
  base: Dataset,
  filled: Dataset,
  tag: string,
  limit?: number,
): TagFillPreviewRow[] {
  const src =
    limit && base.rows.length > limit ? base.rows.slice(-limit) : base.rows

  const wanted = new Set(src.map(r => r.timestamp))
  const afterByTs = new Map<string, number | null>(
    filled.rows
      .filter(r => wanted.has(r.timestamp))
      .map(r => [r.timestamp, r.cells[tag]?.value ?? null]),
  )

  return src.map(r => {
    const cell = r.cells[tag]
    return {
      timestamp: r.timestamp,
      before: cell && cell.status === 'Good' ? cell.value : null,
      after: afterByTs.get(r.timestamp) ?? null,
    }
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
