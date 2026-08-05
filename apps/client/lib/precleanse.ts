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
import type { Cell, DataRow, Dataset } from '@/lib/preprocessing'

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
  // std === 0 means a flat series — nothing can be an outlier.
  if (std === 0) return false
  // zscore and stddev share the same test: |value - mean| > threshold·std.
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
export function precleanse(raw: Dataset, cfg: PrecleanseConfig): Dataset {
  let rows = cloneRows(raw.rows)

  // 1. Crop — keep rows within [from, to] inclusive (ISO strings compare lexically).
  if (cfg.crop) {
    const { from, to } = cfg.crop
    rows = rows.filter(r => r.timestamp >= from && r.timestamp <= to)
  }

  // 1b. Value crop — row-level, per tag. Drop rows whose reading for a cropped
  // tag falls outside [min, max]. Rows missing that tag's cell are kept (no
  // point to judge), so other tags' readings at that timestamp survive.
  if (cfg.valueCrop) {
    for (const [tag, bound] of Object.entries(cfg.valueCrop)) {
      rows = rows.filter(r => {
        const cell = r.cells[tag]
        if (!cell) return true
        return cell.value >= bound.min && cell.value <= bound.max
      })
    }
  }

  // 1c. Exclusions — the inverse of crop. `time` removes whole rows inside the
  // band; `value` drops only the keyed tag's cell inside the band (other tags at
  // that timestamp survive, mirroring the outlier drop-cell semantics below).
  if (cfg.exclusions) {
    for (const ex of cfg.exclusions) {
      if (ex.time) {
        const { from, to } = ex.time
        rows = rows.filter(r => !(r.timestamp >= from && r.timestamp <= to))
      }
      if (ex.value) {
        const { tag, min, max } = ex.value
        for (const r of rows) {
          const cell = r.cells[tag]
          if (cell && cell.value >= min && cell.value <= max)
            delete r.cells[tag]
        }
      }
    }
  }

  const markCell = (cell: Cell | undefined) => {
    if (cell) cell.status = 'Bad'
  }
  // "drop" only ever removes the matched tag's own cell — never the row —
  // so an outlier rule on one tag can't erase every other tag's reading at
  // the same timestamp.
  const dropCell = (row: DataRow, tag: string) => {
    delete row.cells[tag]
  }

  // 2. Statistical rules — flag values beyond `threshold` std-devs from the mean.
  for (const rule of cfg.statistical) {
    if (!rule.enabled) continue
    const tags = rule.tag === 'ALL' ? raw.tags : [rule.tag]
    for (const tag of tags) {
      const { mean, std } = tagStats({ tags: raw.tags, rows }, tag)
      for (const row of rows) {
        const cell = row.cells[tag]
        if (!cell || cell.status !== 'Good') continue
        if (!isStatisticalOutlier(cell.value, mean, std, rule.threshold))
          continue
        if (rule.action === 'drop') dropCell(row, tag)
        else markCell(cell)
      }
    }
  }

  // 3. Conditional rules — flag values satisfying `tag {op} value`.
  for (const rule of cfg.conditional) {
    if (!rule.enabled || rule.value === '') continue
    const target = rule.value
    for (const row of rows) {
      const cell = row.cells[rule.tag]
      if (!cell) continue
      if (!matchesConditional(cell.value, rule.op, target)) continue
      if (rule.action === 'drop') dropCell(row, rule.tag)
      else markCell(cell)
    }
  }
  if (cfg.valueClip) {
    for (const [tag, bound] of Object.entries(cfg.valueClip)) {
      for (const row of rows) {
        const cell = row.cells[tag]
        if (!cell || cell.status !== 'Good') continue
        if (cell.value < bound.min) {
          cell.value = bound.min
          cell.clipped = true
        } else if (cell.value > bound.max) {
          cell.value = bound.max
          cell.clipped = true
        }
      }
    }
  }

  return { tags: raw.tags, rows }
}

/**
 * Per-stage removal counts. Crop stages remove whole **rows**; outlier rules
 * only touch **cells** (mark `Bad` or drop that tag's cell — never the row),
 * so those are counted as affected **points**. Units differ on purpose — the
 * summary labels them accordingly.
 */
export interface PrecleanseRemoved {
  /** Rows dropped by the time crop. */
  timeCrop: number
  /** Rows dropped by the value (Y-axis) crop. */
  valueCrop: number
  /** Rows dropped by dragged time-exclusion bands. */
  exclude: number
  /** Cells flagged/dropped by conditional rules. */
  conditional: number
  /** Cells flagged/dropped by statistical rules. */
  statistical: number
  clipped: number
}

export interface PrecleanseBreakdown {
  /** Fully pre-cleansed dataset (same result as `precleanse(raw, cfg)`). */
  dataset: Dataset
  removed: PrecleanseRemoved
  /** Rows remaining after all stages. */
  keptRows: number
  /** Rows in the raw dataset before any stage. */
  totalRows: number
}

/**
 * Count cells that were `Good` in `a` but are no longer `Good` (marked `Bad`
 * or dropped) in `b`. `a` and `b` must share the same rows — true for the
 * cell-level (statistical/conditional) stages, which never remove rows.
 */
function goodCellsLost(a: Dataset, b: Dataset): number {
  const bByTs = new Map(b.rows.map(r => [r.timestamp, r]))
  let lost = 0
  for (const row of a.rows) {
    const bRow = bByTs.get(row.timestamp)
    for (const tag of a.tags) {
      const ac = row.cells[tag]
      if (!ac || ac.status !== 'Good') continue
      const bc = bRow?.cells[tag]
      if (!bc || bc.status !== 'Good') lost++
    }
  }
  return lost
}

function clippedCells(ds: Dataset): number {
  let n = 0
  for (const row of ds.rows) {
    for (const tag of ds.tags) if (row.cells[tag]?.clipped) n++
  }
  return n
}

/**
 * Run `precleanse` while attributing what each stage removed — powers the
 * Cut-off Summary. Applies the same stage order as `precleanse` (time crop →
 * value crop → statistical → conditional) so the attribution matches the real
 * result. `dataset` equals `precleanse(raw, cfg)`.
 */
export function precleanseBreakdown(
  raw: Dataset,
  cfg: PrecleanseConfig,
): PrecleanseBreakdown {
  const totalRows = raw.rows.length

  const afterCrop = precleanse(raw, {
    crop: cfg.crop,
    conditional: [],
    statistical: [],
  })
  const afterValue = precleanse(raw, {
    crop: cfg.crop,
    valueCrop: cfg.valueCrop,
    conditional: [],
    statistical: [],
  })
  const afterExclude = precleanse(raw, {
    crop: cfg.crop,
    valueCrop: cfg.valueCrop,
    exclusions: cfg.exclusions,
    conditional: [],
    statistical: [],
  })
  const afterStat = precleanse(raw, {
    crop: cfg.crop,
    valueCrop: cfg.valueCrop,
    exclusions: cfg.exclusions,
    conditional: [],
    statistical: cfg.statistical,
  })
  const full = precleanse(raw, cfg)

  return {
    dataset: full,
    removed: {
      timeCrop: totalRows - afterCrop.rows.length,
      valueCrop: afterCrop.rows.length - afterValue.rows.length,
      exclude: afterValue.rows.length - afterExclude.rows.length,
      statistical: goodCellsLost(afterExclude, afterStat),
      conditional: goodCellsLost(afterStat, full),
      clipped: clippedCells(full),
    },
    keptRows: full.rows.length,
    totalRows,
  }
}
