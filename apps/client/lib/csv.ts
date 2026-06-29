/**
 * Pure CSV serialization for a preprocessing `Dataset`.
 *
 * No React, no IO — returns a CSV string; the Blob/anchor download stays in the
 * calling component. Used by the Analytics Quick Visualizer "Export Data" action.
 */
import type { Dataset } from '@/lib/preprocessing'

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
