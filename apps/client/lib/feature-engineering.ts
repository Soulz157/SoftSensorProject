/**
 * Feature engineering transforms — derive new tag columns (lag / rolling /
 * ratio / delta) from an existing `Dataset`. Applied *before* cleansing in the
 * Create-Dataset pipeline (raw → applyFeatures → precleanse → preprocess).
 *
 * Pure module — no React, no IO. Mirrors the style of `lib/precleanse.ts`.
 * An engineered cell is `Good` only when every source cell it reads is `Good`
 * (and defined); otherwise it is emitted as `Bad` (null-equivalent) so a
 * downstream fill strategy can impute it. New columns never remove rows.
 *
 * Column naming: `TI-101__lag3`, `TI-101__roll5_mean`, `A__over__B`,
 * `TI-101__delta`. Double-underscore keeps names free of `.` (recharts-safe).
 */
import type { Cell, DataRow, Dataset } from '@/lib/preprocessing'

export type RollingAgg = 'mean' | 'std' | 'min' | 'max' | 'ROC'

/** Elementwise math op combining two source tags (Divide is `ratio`, not here). */
export type ArithOp = 'add' | 'sub' | 'mul'

/** Calendar component extracted from a row's timestamp. */
export type DatetimePart = 'hour' | 'dayOfWeek' | 'month'

export type FeatureConfig =
  | { id: string; kind: 'lag'; tag: string; k: number }
  | {
      id: string
      kind: 'rolling'
      tag: string
      window: number
      agg: RollingAgg
    }
  | { id: string; kind: 'delta'; tag: string }
  | { id: string; kind: 'arith'; op: ArithOp; tags: string[] }
  | { id: string; kind: 'ratio'; tags: string[] }
  | { id: string; kind: 'log'; tag: string }
  | { id: string; kind: 'datetime'; part: DatetimePart }

/** Deterministic column name for a feature. */
export function featureColumnName(cfg: FeatureConfig): string {
  switch (cfg.kind) {
    case 'lag':
      return `${cfg.tag}__lag${cfg.k}`
    case 'rolling':
      return `${cfg.tag}__roll${cfg.window}_${cfg.agg}`
    case 'ratio':
      return cfg.tags.join('__over__')
    case 'delta':
      return `${cfg.tag}__delta`
    case 'arith':
      return cfg.tags.join(`__${cfg.op}__`)
    case 'log':
      return `${cfg.tag}__log`
    case 'datetime':
      return `__dt_${cfg.part}`
  }
}

const GOOD = 'Good' as const
const BAD = 'Bad' as const

function goodValue(cell: Cell | undefined): number | null {
  return cell && cell.status === GOOD ? cell.value : null
}

function aggregate(values: number[], agg: RollingAgg): number {
  const n = values.length
  if (n === 0) return 0
  switch (agg) {
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / n
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'std': {
      if (n < 2) return 0
      const mean = values.reduce((a, b) => a + b, 0) / n
      const variance =
        values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)
      return Math.sqrt(variance)
    }
    case 'ROC': {
      if (n < 2) return 0
      const first = values[0]!
      const last = values[n - 1]!
      return first === 0 ? 0 : (last - first) / first
    }
  }
}

/** Compute one feature's cell for every row; returns a column keyed by row index. */
function computeColumn(rows: DataRow[], cfg: FeatureConfig): Cell[] {
  return rows.map((row, i): Cell => {
    switch (cfg.kind) {
      case 'lag': {
        const src = rows[i - cfg.k]?.cells[cfg.tag]
        const v = i - cfg.k >= 0 ? goodValue(src) : null
        return v === null
          ? { value: 0, status: BAD }
          : { value: v, status: GOOD }
      }
      case 'delta': {
        const cur = goodValue(row.cells[cfg.tag])
        const prev = i > 0 ? goodValue(rows[i - 1]?.cells[cfg.tag]) : null
        return cur === null || prev === null
          ? { value: 0, status: BAD }
          : { value: cur - prev, status: GOOD }
      }
      case 'ratio': {
        const vals = cfg.tags.map(t => goodValue(row.cells[t]))
        if (vals.some(v => v === null)) return { value: 0, status: BAD }
        const nums = vals as number[]
        if (nums.slice(1).some(v => v === 0)) return { value: 0, status: BAD }
        const value = nums.reduce((acc, v) => acc / v)
        return { value, status: GOOD }
      }
      case 'rolling': {
        const start = Math.max(0, i - cfg.window + 1)
        const values: number[] = []
        let complete = true
        for (let j = start; j <= i; j++) {
          const v = goodValue(rows[j]?.cells[cfg.tag])
          if (v === null) complete = false
          else values.push(v)
        }
        // Require a full window of Good values, else emit Bad.
        if (!complete || i - cfg.window + 1 < 0 || values.length < cfg.window) {
          return { value: 0, status: BAD }
        }
        return { value: aggregate(values, cfg.agg), status: GOOD }
      }
      case 'arith': {
        const vals = cfg.tags.map(t => goodValue(row.cells[t]))
        if (vals.some(v => v === null)) return { value: 0, status: BAD }
        const nums = vals as number[]
        const value =
          cfg.op === 'add'
            ? nums.reduce((a, b) => a + b, 0)
            : cfg.op === 'mul'
              ? nums.reduce((a, b) => a * b, 1)
              : nums.reduce((a, b) => a - b)
        return { value, status: GOOD }
      }
      case 'log': {
        const v = goodValue(row.cells[cfg.tag])
        // Natural log is undefined for non-positive inputs → Bad.
        return v === null || v <= 0
          ? { value: 0, status: BAD }
          : { value: Math.log(v), status: GOOD }
      }
      case 'datetime': {
        // Derived from the row's own timestamp — always defined (Good).
        return { value: datetimePart(row.timestamp, cfg.part), status: GOOD }
      }
    }
  })
}

/**
 * Extract a calendar component from an ISO timestamp. Uses UTC getters so a
 * saved recipe re-derives identical feature values regardless of the viewer's
 * timezone (the pipeline determinism invariant).
 */
function datetimePart(timestamp: string, part: DatetimePart): number {
  const d = new Date(timestamp)
  switch (part) {
    case 'hour':
      return d.getUTCHours()
    case 'dayOfWeek':
      return d.getUTCDay()
    case 'month':
      return d.getUTCMonth() + 1
  }
}

/**
 * Apply feature configs in order, appending one tag column per config.
 * Immutable — returns a new `Dataset`. Duplicate/invalid column names are
 * skipped. Configs referencing an unknown tag still emit a (Bad) column so the
 * recipe stays deterministic.
 */
export function applyFeatures(ds: Dataset, configs: FeatureConfig[]): Dataset {
  if (configs.length === 0) return ds
  const rows: DataRow[] = ds.rows.map(r => ({
    timestamp: r.timestamp,
    cells: Object.fromEntries(
      Object.entries(r.cells).map(([k, v]) => [k, { ...v }]),
    ),
  }))
  const tags = [...ds.tags]

  for (const cfg of configs) {
    const col = featureColumnName(cfg)
    if (tags.includes(col)) continue
    const column = computeColumn(rows, cfg)
    rows.forEach((row, i) => {
      const cell = column[i]
      if (cell) row.cells[col] = cell
    })
    tags.push(col)
  }

  return { tags, rows }
}

/**
 * Feature selection — keep only the chosen columns (original + engineered).
 * `kept === null` keeps every column (default). Immutable: returns a new
 * `Dataset` whose `tags` and per-row `cells` are pruned to `kept`.
 */
export function selectColumns(ds: Dataset, kept: string[] | null): Dataset {
  if (kept === null) return ds
  const keep = new Set(kept)
  const tags = ds.tags.filter(t => keep.has(t))
  const rows: DataRow[] = ds.rows.map(r => ({
    timestamp: r.timestamp,
    cells: Object.fromEntries(
      Object.entries(r.cells).filter(([k]) => keep.has(k)),
    ),
  }))
  return { tags, rows }
}
