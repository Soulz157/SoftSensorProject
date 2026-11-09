/**
 * How a validation check's `measured` / `threshold` read in the UI
 * (2026-10-19). They were printed raw - "measured 0.1234, threshold 0.05" -
 * though each check speaks its own unit (`validation_service.py`):
 *
 *   missing_values  percent, 0-100        "worst 37.5% missing (limit 20%)"
 *   statistical     fraction, 0-1         "worst 12.3% outliers (limit 5%)"
 *                   ...or a COUNT when only zero-variance tags failed
 *   everything else a count against 0     "3 found"
 *
 * Returns null when there is nothing worth saying.
 *
 * Pure module - no React, no IO.
 */

function pct(value: number, digits: number): string {
  return `${Number(value.toFixed(digits))}%`
}

export function formatCheckMeasure(
  name: string,
  measured: number | null | undefined,
  threshold: number | null | undefined,
): string | null {
  if (measured == null || !Number.isFinite(measured)) return null

  if (name === 'missing_values') {
    const limit = threshold != null ? ` (limit ${pct(threshold, 1)})` : ''
    return `worst ${pct(measured, 1)} missing${limit}`
  }

  if (name === 'statistical') {
    // `measured` is the worst outlier FRACTION when any tag crossed the
    // threshold, else the number of zero-variance tags (a whole number >= 1).
    const isFraction = measured < 1 || !Number.isInteger(measured)
    if (!isFraction) {
      return `${measured} zero-variance ${measured === 1 ? 'tag' : 'tags'}`
    }
    const limit = threshold != null ? ` (limit ${pct(threshold * 100, 1)})` : ''
    return `worst ${pct(measured * 100, 1)} outliers${limit}`
  }

  return `${Number(measured.toFixed(2))} found`
}
