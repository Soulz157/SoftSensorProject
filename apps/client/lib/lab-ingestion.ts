/**
 * Laboratory ground-truth ingestion + alignment (single source of truth).
 *
 * Pure module — no React, no IO. Turns user-supplied lab measurements (manual
 * entry or CSV) into `LabPoint[]`, and aligns them to the model's prediction
 * series by nearest timestamp so error metrics can be computed over the matched
 * pairs only (see `computeMetrics` in `lib/model-evaluation.ts`).
 *
 * No mock lab data lives here — the lab/actual series is the user's real input.
 */

import type { PredPoint } from '@/lib/mock-lab-data'
import type { EvalPoint } from '@/lib/model-evaluation'

/** One user-supplied laboratory measurement (ground truth). */
export interface LabPoint {
  /** ISO 8601 UTC. */
  timestamp: string
  value: number
}

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

/** True when a cell parses to a finite number. */
function isNumeric(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s))
}

/**
 * Parse CSV text into `LabPoint[]`. Header-tolerant: a leading
 * `timestamp,value` (or any non-data) header row is detected and skipped.
 * Each data row is `timestamp,value`; unparseable rows are collected in
 * `errors` (1-based row numbers) rather than throwing.
 */
export function parseLabCsv(text: string): {
  points: LabPoint[]
  errors: string[]
} {
  const points: LabPoint[] = []
  const errors: string[] = []

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return { points, errors }

  // Skip a header row when its 2nd column isn't numeric (e.g. "timestamp,value").
  const firstCols = (lines[0] ?? '').split(',')
  const headerSecond = firstCols[1]
  const hasHeader = headerSecond !== undefined && !isNumeric(headerSecond)
  const dataLines = hasHeader ? lines.slice(1) : lines

  dataLines.forEach((line, i) => {
    const rowNo = (hasHeader ? i + 2 : i + 1).toString()
    const [tsCol, valCol] = line.split(',')
    if (tsCol === undefined || valCol === undefined) {
      errors.push(`Row ${rowNo}: expected "timestamp,value"`)
      return
    }
    const tsRaw = tsCol.trim()
    const valRaw = valCol.trim()
    const ms = Date.parse(tsRaw)
    if (Number.isNaN(ms)) {
      errors.push(`Row ${rowNo}: invalid timestamp "${tsRaw}"`)
      return
    }
    if (!isNumeric(valRaw)) {
      errors.push(`Row ${rowNo}: invalid value "${valRaw}"`)
      return
    }
    points.push({
      timestamp: new Date(ms).toISOString(),
      value: Number(valRaw),
    })
  })

  return { points, errors }
}

/**
 * Align each lab point to its nearest prediction timestamp within
 * `toleranceMs`, producing `EvalPoint[]` (`predicted` from the model series,
 * `actual` from the lab measurement). Lab points with no prediction inside the
 * tolerance window are dropped. When multiple lab points snap to the same
 * prediction, the closest one wins. Returned ascending by timestamp.
 */
export function alignLabToPredictions(
  preds: PredPoint[],
  labs: LabPoint[],
  toleranceMs: number,
): EvalPoint[] {
  if (preds.length === 0 || labs.length === 0) return []

  const predEntries = preds.map(p => ({ pred: p, ms: Date.parse(p.timestamp) }))
  // Keyed by prediction timestamp → best (closest) lab match so far.
  const best = new Map<
    string,
    { pred: PredPoint; lab: LabPoint; dist: number }
  >()

  for (const lab of labs) {
    const labMs = Date.parse(lab.timestamp)
    let match: { pred: PredPoint; dist: number } | null = null
    for (const { pred, ms } of predEntries) {
      const d = Math.abs(ms - labMs)
      if (!match || d < match.dist) match = { pred, dist: d }
    }
    if (!match || match.dist > toleranceMs) continue
    const key = match.pred.timestamp
    const existing = best.get(key)
    if (!existing || match.dist < existing.dist) {
      best.set(key, { pred: match.pred, lab, dist: match.dist })
    }
  }

  const out: EvalPoint[] = []
  for (const { pred, lab } of best.values()) {
    const actual = lab.value
    out.push({
      timestamp: pred.timestamp,
      predicted: pred.predicted,
      actual,
      residual: round(pred.predicted - actual),
    })
  }
  out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  return out
}
