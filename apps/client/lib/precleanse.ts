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
 * fill strategy can then impute them) or, per-rule, drops the whole row.
 */
import type { CutoffOp } from '@/types/cutoff'
import type { Cell, DataRow, Dataset } from '@/lib/preprocessing'

export type CropRange = { from: string; to: string } | null

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
  conditional: ConditionalRule[]
  statistical: StatisticalRule[]
}

export const EMPTY_PRECLEANSE_CONFIG: PrecleanseConfig = {
  crop: null,
  conditional: [],
  statistical: [],
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
 * Apply crop + outlier rules. Order: (1) crop rows to the inclusive time window,
 * (2) statistical rules, (3) conditional rules. Immutable — returns a new
 * dataset. Disabled or incomplete rules are skipped.
 */
export function precleanse(raw: Dataset, cfg: PrecleanseConfig): Dataset {
  let rows = cloneRows(raw.rows)

  // 1. Crop — keep rows within [from, to] inclusive (ISO strings compare lexically).
  if (cfg.crop) {
    const { from, to } = cfg.crop
    rows = rows.filter(r => r.timestamp >= from && r.timestamp <= to)
  }

  const rowsToDrop = new Set<string>()
  const markCell = (cell: Cell | undefined) => {
    if (cell) cell.status = 'Bad'
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
        if (rule.action === 'drop') rowsToDrop.add(row.timestamp)
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
      if (rule.action === 'drop') rowsToDrop.add(row.timestamp)
      else markCell(cell)
    }
  }

  if (rowsToDrop.size > 0) {
    rows = rows.filter(r => !rowsToDrop.has(r.timestamp))
  }

  return { tags: raw.tags, rows }
}
