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

export type RollingAgg = 'mean' | 'std' | 'min' | 'max'

export type FeatureConfig =
  | { id: string; kind: 'lag'; tag: string; k: number }
  | {
      id: string
      kind: 'rolling'
      tag: string
      window: number
      agg: RollingAgg
    }
  | { id: string; kind: 'ratio'; a: string; b: string }
  | { id: string; kind: 'delta'; tag: string }

/** Deterministic column name for a feature. */
export function featureColumnName(cfg: FeatureConfig): string {
  switch (cfg.kind) {
    case 'lag':
      return `${cfg.tag}__lag${cfg.k}`
    case 'rolling':
      return `${cfg.tag}__roll${cfg.window}_${cfg.agg}`
    case 'ratio':
      return `${cfg.a}__over__${cfg.b}`
    case 'delta':
      return `${cfg.tag}__delta`
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
        const a = goodValue(row.cells[cfg.a])
        const b = goodValue(row.cells[cfg.b])
        return a === null || b === null || b === 0
          ? { value: 0, status: BAD }
          : { value: a / b, status: GOOD }
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
    }
  })
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
