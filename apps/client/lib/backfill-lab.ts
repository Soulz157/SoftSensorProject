/**
 * MODEL-SERVE-032. The Evaluation page's editable lab series. Pure, no IO.
 *
 * Rows start as the raw recorded lab events the server returned. The user may
 * correct a value, remove one, or add their own; every change is kept
 * distinguishable from the imported original so the page can show it, reset
 * it, and so a write-back knows what it is writing.
 *
 * Rows are keyed by INSTANT (epoch ms), not by the timestamp string: the same
 * moment spelled `…:00Z` and `…:00.000Z` is one row.
 */

import { parseLabCsv, type LabPoint } from '@/lib/lab-ingestion'
import { stampToUtcIso } from '@/lib/backfill-compare'

export type LabOrigin = 'imported' | 'edited' | 'added'

export interface LabRow {
  /** Normalised ISO `Z`. */
  timestamp: string
  value: number
  origin: LabOrigin
  /** The imported value; null for a row the user added. */
  originalValue: number | null
  /** An imported row the user took out of the comparison. Kept (not dropped)
   *  so it can be restored; an ADDED row is simply deleted instead. */
  removed: boolean
}

const key = (iso: string) => Date.parse(iso)

function sorted(rows: LabRow[]): LabRow[] {
  return [...rows].sort((a, b) => key(a.timestamp) - key(b.timestamp))
}

export function seedLab(
  events: ReadonlyArray<{ t: string; value: number }>,
): LabRow[] {
  return sorted(
    events.map(e => ({
      timestamp: new Date(e.t).toISOString(),
      value: e.value,
      origin: 'imported' as const,
      originalValue: e.value,
      removed: false,
    })),
  )
}

/** Set the value of the row at `timestamp`; ignores a non-finite value. An
 *  imported row set back to its original value is `imported` again. */
export function editLabRow(
  rows: readonly LabRow[],
  timestamp: string,
  value: number,
): LabRow[] {
  if (!Number.isFinite(value)) return [...rows]
  const k = key(timestamp)
  return rows.map(r => {
    if (key(r.timestamp) !== k) return r
    if (r.originalValue === null) return { ...r, value }
    return {
      ...r,
      value,
      removed: false,
      origin: value === r.originalValue ? 'imported' : 'edited',
    }
  })
}

/** Add a point. On a collision with an existing row it becomes that row's
 *  edit (an imported row stays traceable to its original). */
export function addLabRow(rows: readonly LabRow[], point: LabPoint): LabRow[] {
  if (!Number.isFinite(point.value) || !Number.isFinite(key(point.timestamp))) {
    return [...rows]
  }
  const iso = new Date(point.timestamp).toISOString()
  const exists = rows.some(r => key(r.timestamp) === key(iso))
  if (exists) return editLabRow(rows, iso, point.value)
  return sorted([
    ...rows,
    {
      timestamp: iso,
      value: point.value,
      origin: 'added',
      originalValue: null,
      removed: false,
    },
  ])
}

export function addLabRows(
  rows: readonly LabRow[],
  points: readonly LabPoint[],
): LabRow[] {
  return points.reduce<LabRow[]>((acc, p) => addLabRow(acc, p), [...rows])
}

/** Imported rows are marked removed (restorable); added rows are deleted. */
export function removeLabRow(
  rows: readonly LabRow[],
  timestamp: string,
): LabRow[] {
  const k = key(timestamp)
  return rows.flatMap(r => {
    if (key(r.timestamp) !== k) return [r]
    return r.origin === 'added' ? [] : [{ ...r, removed: true }]
  })
}

export function restoreLabRow(
  rows: readonly LabRow[],
  timestamp: string,
): LabRow[] {
  const k = key(timestamp)
  return rows.map(r => (key(r.timestamp) === k ? { ...r, removed: false } : r))
}

/** What the comparison and a lab write-back use: everything not removed. */
export function activeLab(rows: readonly LabRow[]): LabPoint[] {
  return rows
    .filter(r => !r.removed)
    .map(r => ({ timestamp: r.timestamp, value: r.value }))
}

/** Edited + added + removed rows: how far the series has moved from import. */
export function labChangeCount(rows: readonly LabRow[]): number {
  return rows.filter(r => r.origin !== 'imported' || r.removed).length
}

const NAIVE_STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?$/

/**
 * `parseLabCsv`, with one correction for this page: a timestamp written
 * WITHOUT a zone is plant time (Bangkok), like everything else on the page —
 * not whatever zone the browser happens to be in. Stamps that already carry
 * `Z` or an offset are left exactly as they are.
 */
export function parseLabCsvPlantTime(text: string): {
  points: LabPoint[]
  errors: string[]
} {
  const fixed = text
    .split(/\r?\n/)
    .map(line => {
      const comma = line.indexOf(',')
      if (comma === -1) return line
      const ts = line.slice(0, comma).trim()
      const m = NAIVE_STAMP.exec(ts)
      if (!m) return line
      const iso = stampToUtcIso(`${m[1]}T${m[2]}`)
      if (!iso) return line
      const seconds = m[3] ?? ':00'
      // Rebuild with the original seconds, then pin to +07:00.
      return `${m[1]}T${m[2]}${seconds}+07:00${line.slice(comma)}`
    })
    .join('\n')
  return parseLabCsv(fixed)
}
