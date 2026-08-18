/**
 * Step 5.1 "Data Preprocessing" transforms — time-range cropping + outlier
 * removal — applied to a raw `Dataset` *before* the fill/imputation stage.
 *
 * Pure module — no React, no IO. Mirrors the style of `lib/preprocessing.ts`.
 *
 * NAMING: this is `precleanse`, deliberately NOT `preprocess`. The wizard UI
 * labels this sub-step "Preprocessing" (5.1), but the code's `preprocess()`
 * (`lib/preprocessing.ts`) is the *fill/imputation* op = sub-step 5.2. Pipeline
 * order is: raw → precleanse → preprocess(fill) → toModelReady.
 *
 * Outlier removal marks matched cells `Bad` (null-equivalent — a downstream
 * fill strategy can then impute them) or, per-rule, drops just that tag's
 * cell at the matched row — every other tag's reading at that same
 * timestamp is left untouched, and the row itself is never removed.
 */
import type { CutoffOp } from '@/types/cutoff'
import {
  brandBoundedSample,
  cloneRow,
  type BoundedSample,
  type Cell,
  type DataRow,
  type Dataset,
} from '@/lib/preprocessing'

export type CropRange = { from: string; to: string } | null
export interface ClipBound {
  min: number
  max: number
}

/**
 * Per-tag value (Y-axis) crop bounds. A row is dropped when the keyed tag's
 * reading falls outside `[min, max]` — the row-level counterpart of a time
 * crop, so a drag-box on the chart trims both axes. Keyed by tag (mirrors the
 * `fillStrategies` shape) so a tag's crop survives switching the selected tag.
 */
export type ValueCrop = Record<string, { min: number; max: number }>

export type ValueClip = Record<string, ClipBound>

/**
 * A user-dragged exclusion (the inverse of `crop`). `time` removes whole rows
 * whose timestamp is INSIDE `[from, to]`; `value` drops the keyed tag's cell
 * where its reading is INSIDE `[min, max]`. Either half may be null.
 */
export interface RangeExclusion {
  time: { from: string; to: string } | null
  value: { tag: string; min: number; max: number } | null
}

export interface ClipImpact {
  /** จำนวนจุดที่ต่ำกว่า min */
  below: number
  /** จำนวนจุดที่สูงกว่า max */
  above: number
  total: number
  /** จำนวนจุดที่มีค่า (ไม่นับ null/NaN) ใช้เป็นตัวหาร */
  points: number
}

/** `mark` → set the matched cell's status to `Bad`; `drop` → remove the row. */
export type OutlierAction = 'mark' | 'drop'

export interface ConditionalRule {
  id: string
  tag: string
  op: CutoffOp
  value: number | ''
  action: OutlierAction
  enabled: boolean
}

export type StatisticalMethod = 'zscore' | 'stddev'

export interface StatisticalRule {
  id: string
  /** A tag name, or `'ALL'` to apply the rule to every tag. */
  tag: string | 'ALL'
  method: StatisticalMethod
  threshold: number
  action: OutlierAction
  enabled: boolean
}

export interface PrecleanseConfig {
  crop: CropRange
  /** Per-tag Y-axis crop bounds. Optional — omitting it is a no-op. */
  valueCrop?: ValueCrop
  valueClip?: ValueClip
  /** Dragged exclusion bands (remove-inside). Optional — omitting it is a no-op. */
  exclusions?: RangeExclusion[]
  conditional: ConditionalRule[]
  statistical: StatisticalRule[]
}

export const EMPTY_PRECLEANSE_CONFIG: PrecleanseConfig = {
  crop: null,
  valueCrop: {},
  valueClip: {},
  exclusions: [],
  conditional: [],
  statistical: [],
}

export function clipImpact(
  dataset: Dataset,
  tag: string,
  min: number,
  max: number,
): ClipImpact {
  let below = 0
  let above = 0
  let points = 0
  for (const row of dataset.rows) {
    const cell = row.cells[tag]
    if (!cell || cell.status !== 'Good' || !Number.isFinite(cell.value))
      continue
    points++
    if (cell.value < min) below++
    else if (cell.value > max) above++
  }
  return { below, above, total: below + above, points }
}

export function applyValueClip(dataset: Dataset, clip: ValueClip): Dataset {
  const tags = Object.keys(clip).filter(t => dataset.tags.includes(t))
  if (tags.length === 0) return dataset

  let touched = false
  const rows = dataset.rows.map(row => {
    let nextCells: (typeof row)['cells'] | null = null

    for (const tag of tags) {
      const cell = row.cells[tag]
      if (!cell || !Number.isFinite(cell.value)) continue

      const { min, max } = clip[tag]!
      const clamped =
        cell.value < min ? min : cell.value > max ? max : cell.value
      if (clamped === cell.value) continue

      nextCells ??= { ...row.cells }
      // เพิ่ม marker ไว้ที่นี่ถ้า cell type รองรับ (ดูหมายเหตุ)
      nextCells[tag] = { ...cell, value: clamped }
      touched = true
    }

    return nextCells ? { ...row, cells: nextCells } : row
  })

  return touched ? { ...dataset, rows } : dataset
}

export function percentileBounds(
  dataset: Dataset,
  tag: string,
  loPct: number,
  hiPct: number,
): ClipBound | null {
  const vals: number[] = []
  for (const row of dataset.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good' && Number.isFinite(cell.value)) {
      vals.push(cell.value)
    }
  }
  if (vals.length === 0) return null
  vals.sort((a, b) => a - b)

  const at = (p: number): number => {
    const idx = ((vals.length - 1) * p) / 100
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return lo === hi
      ? vals[lo]!
      : vals[lo]! + (vals[hi]! - vals[lo]!) * (idx - lo)
  }
  return { min: at(loPct), max: at(hiPct) }
}

/**
 * DS-LAKE-005B-B-T04: bounded-input entry point for `percentileBounds`.
 *
 * ADDITIVE, not a replacement — `percentileBounds` above keeps its `Dataset`
 * signature because every current caller (`data-cropping-chart.tsx:456`,
 * via `clipSource ?? rawDataset`) still holds `dwRawDatasetAtom`'s full,
 * unbounded frame; T01 (the viewport migration that would give Step 3.1 a
 * real windowed/bounded value to pass here) is still `blocked`. Retyping the
 * existing signature today would break that live component for no working
 * replacement.
 *
 * This function exists so V03 has a real, non-speculative entry point to
 * gate: `BoundedSample extends Dataset`, so passing a `BoundedSample` in is
 * always fine — the type error V03 tests for is a caller trying to pass a
 * BARE `Dataset` in instead. Once T01 ships a windowed reader for Step 3.1,
 * that call site switches to THIS function and the compiler enforces it can
 * never again receive an unbounded frame.
 */
export function percentileBoundsBounded(
  sample: BoundedSample,
  tag: string,
  loPct: number,
  hiPct: number,
): ClipBound | null {
  return percentileBounds(sample, tag, loPct, hiPct)
}

/**
 * Index of the row whose timestamp is closest to `targetMs` (epoch ms).
 * `timestamps` are ascending ISO strings. Linear min-abs-diff scan — datasets
 * are small enough that a bisect isn't worth it. Returns `0` for empty input.
 *
 * Used to snap a typed datetime (from the crop time inputs) onto a real row
 * index, since the time-crop slider is index-based over actual row timestamps.
 */
export function nearestTimestampIndex(
  timestamps: string[],
  targetMs: number,
): number {
  if (timestamps.length === 0) return 0
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < timestamps.length; i++) {
    const diff = Math.abs(new Date(timestamps[i]!).getTime() - targetMs)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}

function cloneRows(rows: DataRow[]): DataRow[] {
  return rows.map(r => ({
    timestamp: r.timestamp,
    cells: Object.fromEntries(
      Object.entries(r.cells).map(([k, v]) => [k, { ...v }]),
    ),
  }))
}

/** Mean + sample std-dev over a tag's `Good` cells (outlier basis). */
export function tagStats(
  ds: Dataset,
  tag: string,
): { mean: number; std: number } {
  const values: number[] = []
  for (const row of ds.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good') values.push(cell.value)
  }
  const n = values.length
  if (n === 0) return { mean: 0, std: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { mean, std: 0 }
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)
  return { mean, std: Math.sqrt(variance) }
}

function matchesConditional(
  value: number,
  op: CutoffOp,
  target: number,
): boolean {
  switch (op) {
    case '>':
      return value > target
    case '>=':
      return value >= target
    case '<':
      return value < target
    case '<=':
      return value <= target
    case '==':
      return value === target
    case '!=':
      return value !== target
    default:
      return false
  }
}

function isStatisticalOutlier(
  value: number,
  mean: number,
  std: number,
  threshold: number,
): boolean {
  if (std === 0) return false
  return Math.abs(value - mean) > threshold * std
}

/**
 * Count how many `Good` cells a single statistical rule would flag — powers the
 * "N points affected" live preview in the Outlier panel. Does not mutate.
 */
export function statisticalMatchCount(
  ds: Dataset,
  rule: StatisticalRule,
): number {
  const tags = rule.tag === 'ALL' ? ds.tags : [rule.tag]
  let count = 0
  for (const tag of tags) {
    const { mean, std } = tagStats(ds, tag)
    for (const row of ds.rows) {
      const cell = row.cells[tag]
      if (
        cell &&
        cell.status === 'Good' &&
        isStatisticalOutlier(cell.value, mean, std, rule.threshold)
      ) {
        count++
      }
    }
  }
  return count
}

/**
 * Apply crop + outlier rules. Order: (1) time crop, (1b) value crop (both
 * row-level), (2) statistical rules, (3) conditional rules (both cell-level).
 * Immutable — returns a new dataset. Disabled or incomplete rules are skipped.
 */
// ─── internal pipeline ─────────────────────────────────────────────────────

export interface PrecleanseRemoved {
  timeCrop: number
  valueCrop: number
  exclude: number
  excludeCells: number
  conditional: number
  statistical: number
  clipped: number
}

export interface PrecleanseBreakdown {
  dataset: Dataset
  removed: PrecleanseRemoved
  keptRows: number
  totalRows: number
  beforeRules?: Dataset
}
interface StageCounts {
  timeCrop: number
  valueCrop: number
  exclude: number
  excludeCells: number
  statistical: number
  conditional: number
  clipped: number
}

const zeroCounts = (): StageCounts => ({
  timeCrop: 0,
  valueCrop: 0,
  exclude: 0,
  excludeCells: 0,
  statistical: 0,
  conditional: 0,
  clipped: 0,
})

interface RunResult {
  rows: DataRow[]
  counts: StageCounts
  beforeRules?: DataRow[]
}

/**
 * The whole pipeline in ONE pass.
 *
 * Phase A filters using the ORIGINAL row objects — a filter never writes, so
 * nothing needs cloning yet. Phase B clones only the survivors. Phase C mutates
 * those clones in place and increments a counter at every write site, which is
 * what lets `precleanseBreakdown` report per-stage numbers without re-running
 * the pipeline and diffing datasets.
 */
function runPipeline(
  raw: Dataset,
  cfg: PrecleanseConfig,
  wantBeforeRules = false,
): RunResult {
  const counts = zeroCounts()

  let rows: DataRow[] = raw.rows

  if (cfg.crop) {
    const { from, to } = cfg.crop
    const before = rows.length
    rows = rows.filter(r => r.timestamp >= from && r.timestamp <= to)
    counts.timeCrop = before - rows.length
  }
  const cropEntries = cfg.valueCrop ? Object.entries(cfg.valueCrop) : []
  if (cropEntries.length > 0) {
    const before = rows.length
    rows = rows.filter(r => {
      for (const [tag, bound] of cropEntries) {
        const cell = r.cells[tag]
        // Rows missing that tag's cell are kept — no reading to judge.
        if (cell && (cell.value < bound.min || cell.value > bound.max)) {
          return false
        }
      }
      return true
    })
    counts.valueCrop = before - rows.length
  }

  const timeBands = (cfg.exclusions ?? [])
    .map(e => e.time)
    .filter((t): t is NonNullable<RangeExclusion['time']> => t !== null)
  const excludeValues = (cfg.exclusions ?? [])
    .map(e => e.value)
    .filter((v): v is NonNullable<RangeExclusion['value']> => v !== null)

  if (timeBands.length > 0) {
    const before = rows.length
    rows = rows.filter(
      r => !timeBands.some(b => r.timestamp >= b.from && r.timestamp <= b.to),
    )
    counts.exclude = before - rows.length
  }

  const out: DataRow[] = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) out[i] = cloneRow(rows[i]!)

  for (const { tag, min, max } of excludeValues) {
    for (const row of out) {
      const cell = row.cells[tag]
      if (!cell || cell.value < min || cell.value > max) continue
      if (cell.status === 'Good') counts.excludeCells++
      delete row.cells[tag]
    }
  }

  const beforeRules = !wantBeforeRules
    ? undefined
    : excludeValues.length === 0
      ? rows === raw.rows
        ? rows.slice()
        : rows
      : out.map(cloneRow)

  for (const rule of cfg.statistical) {
    if (!rule.enabled) continue
    const tags = rule.tag === 'ALL' ? raw.tags : [rule.tag]
    for (const tag of tags) {
      const { mean, std } = tagStats({ tags: raw.tags, rows: out }, tag)
      if (std === 0) continue
      for (const row of out) {
        const cell = row.cells[tag]
        if (!cell || cell.status !== 'Good') continue
        if (!isStatisticalOutlier(cell.value, mean, std, rule.threshold)) {
          continue
        }
        counts.statistical++
        if (rule.action === 'drop') delete row.cells[tag]
        else cell.status = 'Bad'
      }
    }
  }

  for (const rule of cfg.conditional) {
    if (!rule.enabled || rule.value === '') continue
    const target = rule.value
    for (const row of out) {
      const cell = row.cells[rule.tag]
      if (!cell) continue
      if (!matchesConditional(cell.value, rule.op, target)) continue
      if (cell.status === 'Good') counts.conditional++
      if (rule.action === 'drop') delete row.cells[rule.tag]
      else cell.status = 'Bad'
    }
  }

  const clipEntries = cfg.valueClip ? Object.entries(cfg.valueClip) : []
  for (const [tag, bound] of clipEntries) {
    for (const row of out) {
      const cell = row.cells[tag]
      if (!cell || cell.status !== 'Good') continue
      if (cell.value < bound.min) {
        cell.value = bound.min
        cell.clipped = true
        counts.clipped++
      } else if (cell.value > bound.max) {
        cell.value = bound.max
        cell.clipped = true
        counts.clipped++
      }
    }
  }

  return { rows: out, counts, beforeRules }
}

export function precleanse(raw: Dataset, cfg: PrecleanseConfig): Dataset {
  return { tags: raw.tags, rows: runPipeline(raw, cfg).rows }
}

/**
 * DS-LAKE-005B-D-T07. `BoundedSample`-in/`BoundedSample`-out sibling of
 * `precleanse` — the entry point `Step31EDA` now feeds `DataAnalysisCard`
 * with, so a bare `Dataset` can no longer reach that card's `dataset` prop
 * (mirrors `percentileBoundsBounded`'s own gate above: `BoundedSample
 * extends Dataset`, so passing one in is always fine; the type error this
 * exists to produce is a caller trying to pass a BARE `Dataset` instead).
 *
 * ADDITIVE, not a replacement — `precleanse` above keeps its `Dataset`
 * signature because `data-cropping-chart.tsx` still holds `dwRawDatasetAtom`'s
 * full frame and that migration is DS-LAKE-005B-D-T08's job, not this one.
 * `Step31EDA` itself also keeps calling `precleanse` on the full `raw` frame
 * for its own `emptied`/`nextDisabled` gating — that gate needs the TRUE
 * row count, which a bounded sample cannot answer correctly (a rule could
 * empty the first N rows of a sample while thousands of real rows survive
 * elsewhere in the artifact). Only the value handed to `DataAnalysisCard`
 * switches to this function.
 *
 * Crop/conditional/statistical rules only ever REMOVE rows or mutate cell
 * values/status in place (see `runPipeline` above) — never add rows — so a
 * bounded input always produces a bounded-or-smaller output; re-branding
 * the result is safe, same argument `applyFeaturesBounded` makes in
 * `feature-engineering.ts`.
 */
export function precleanseBounded(
  sample: BoundedSample,
  cfg: PrecleanseConfig,
): BoundedSample {
  return brandBoundedSample(precleanse(sample, cfg))
}

export function precleanseBreakdown(
  raw: Dataset,
  cfg: PrecleanseConfig,
  opts: { withBeforeRules?: boolean } = {},
): PrecleanseBreakdown {
  const { rows, counts, beforeRules } = runPipeline(
    raw,
    cfg,
    opts.withBeforeRules,
  )
  return {
    dataset: { tags: raw.tags, rows },
    removed: {
      timeCrop: counts.timeCrop,
      valueCrop: counts.valueCrop,
      exclude: counts.exclude,
      excludeCells: counts.excludeCells,
      statistical: counts.statistical,
      conditional: counts.conditional,
      clipped: counts.clipped,
    },
    beforeRules: beforeRules
      ? { tags: raw.tags, rows: beforeRules }
      : undefined,
    keptRows: rows.length,
    totalRows: raw.rows.length,
  }
}
