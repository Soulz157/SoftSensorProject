/**
 * Pure CSV serialization + parsing for a preprocessing `Dataset`.
 *
 * No React, no IO — `datasetToCsv` returns a CSV string and `csvToDataset`
 * consumes already-read text; the Blob/anchor download and the FileReader stay
 * in the calling component/hook. Used by the Analytics Quick Visualizer
 * "Export Data" action and by the Dataset Wizard's CSV upload, which is the
 * fetch-free source of `dwRawDatasetAtom`.
 */
import type { Cell, DataRow, Dataset } from '@/lib/preprocessing'
import { MATERIALIZE_EPOCH } from '@/lib/pipeline-config'

/** Quote a field if it contains a comma, quote, or newline (RFC 4180). */
function escapeField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Serialize a `Dataset` to CSV.
 * Header: `timestamp` + one column per tag. Empty cell → blank field.
 */
export function datasetToCsv(ds: Dataset): string {
  const header = ['timestamp', ...ds.tags]
  const lines = [header.map(escapeField).join(',')]

  for (const row of ds.rows) {
    const fields = [
      row.timestamp,
      ...ds.tags.map(tag => {
        const cell = row.cells[tag]
        return cell ? String(cell.value) : ''
      }),
    ]
    lines.push(fields.map(escapeField).join(','))
  }

  return lines.join('\n')
}

/**
 * Build a safe `.csv` download filename for a dataset. Slugs the dataset name
 * when the user has entered one; otherwise falls back to `pi-readings-<range>`
 * (matching the Quick Visualizer convention). Pure — no IO.
 */
export function datasetCsvFilename(
  name: string,
  fallbackRange: string,
): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || `pi-readings-${fallbackRange}`}.csv`
}

/** Header columns + one string-keyed record per data line. */
export interface ParsedCsv {
  columns: string[]
  rows: Record<string, string>[]
}

/** Spacing between synthesized timestamps when the file carries no time column. */
const SYNTHETIC_STEP_MS = 60_000

/** Trim a field and drop one layer of surrounding single/double quotes. */
function unquote(field: string): string {
  return field.trim().replace(/^["']|["']$/g, '')
}

/**
 * Parse CSV text into header columns + row records.
 *
 * Deliberately simple (split on newline/comma, strip surrounding quotes) — the
 * single implementation replacing the two ad-hoc copies that used to live in
 * `csv-config-form.tsx` and `use-dataset-tag-table.ts`. Quoted fields that
 * themselves contain commas are not supported, matching the previous behaviour.
 */
export function parseCsvText(text: string): ParsedCsv {
  const lines = text
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim().length > 0)

  const header = lines[0]
  if (!header) return { columns: [], rows: [] }

  const columns = header.split(',').map(unquote).filter(Boolean)
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(unquote)
    return Object.fromEntries(columns.map((c, i) => [c, values[i] ?? '']))
  })

  return { columns, rows }
}

/** First column that looks like a time axis, or `null` when none does. */
export function detectTimestampColumn(columns: string[]): string | null {
  return columns.find(c => /time|date|timestamp/i.test(c)) ?? null
}

export interface CsvToDatasetOptions {
  /** Explicit time column; omit to auto-detect, pass `null` to force synthetic. */
  timestampColumn?: string | null
  /** Base for synthesized timestamps. Defaults to the materialize epoch. */
  epoch?: number
  /** Spacing for synthesized timestamps. Defaults to 1 minute. */
  stepMs?: number
}

/**
 * Materialize parsed CSV into a `Dataset` — the CSV counterpart of
 * `piResponseToDataset`, and what lets a CSV-only wizard run reach Step 3
 * without any fetch.
 *
 * Timestamps are normalized to ISO 8601 because every consumer sorts them
 * lexicographically; rows whose time cell is missing or unparseable (and every
 * row when the file has no time column at all) fall back to a deterministic
 * synthetic series so the grid still sorts chronologically.
 *
 * Invariant shared with the PI path: a Bad cell always carries value 0 — blank
 * and non-numeric fields become `{ value: 0, status: 'Bad' }` rather than being
 * dropped, so `datasetQuality` and the Step-3.2 imputation UI see them as
 * missing instead of as a real zero reading.
 */
export function csvToDataset(
  parsed: ParsedCsv,
  options: CsvToDatasetOptions = {},
): Dataset {
  const { columns, rows } = parsed
  const timestampColumn =
    options.timestampColumn === undefined
      ? detectTimestampColumn(columns)
      : options.timestampColumn
  const epoch = options.epoch ?? MATERIALIZE_EPOCH
  const stepMs = options.stepMs ?? SYNTHETIC_STEP_MS

  const tags = columns.filter(c => c !== timestampColumn)

  // Same-timestamp lines collapse into one row (last value wins), mirroring the
  // by-timestamp map in `piResponseToDataset`.
  const byTs = new Map<string, DataRow>()
  rows.forEach((row, index) => {
    const rawTs = timestampColumn ? (row[timestampColumn] ?? '').trim() : ''
    const parsedTs = rawTs ? new Date(rawTs) : null
    const timestamp =
      parsedTs && !Number.isNaN(parsedTs.getTime())
        ? parsedTs.toISOString()
        : new Date(epoch + index * stepMs).toISOString()

    const cells: Record<string, Cell> = byTs.get(timestamp)?.cells ?? {}
    for (const tag of tags) {
      const raw = (row[tag] ?? '').trim()
      // `Number('')` is 0 — treat a blank field as missing, not as a reading.
      const value = raw === '' ? Number.NaN : Number(raw)
      cells[tag] = Number.isFinite(value)
        ? { value, status: 'Good' }
        : { value: 0, status: 'Bad' }
    }
    byTs.set(timestamp, { timestamp, cells })
  })

  const out = Array.from(byTs.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : 1,
  )

  return { tags, rows: out }
}
