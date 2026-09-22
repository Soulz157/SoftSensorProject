import type { SensorChartRow } from '@/hooks/use-sensor-readings'

/**
 * Most rows the trend chart is asked to draw. Recharts renders one SVG path
 * per tag, so cost is rows × tags: past a few thousand points per series the
 * hover/tooltip layer lags even though the fetch and the tables are fine.
 * Rows are loaded up to 10,000 (see `use-dataset-feature-preview-sample.ts`);
 * only what the CHART draws is cut down to this.
 */
export const CHART_MAX_POINTS = 2_000

/** Ceiling on rows LOADED for an EDA preview, whatever the tag count. */
export const PREVIEW_MAX_ROWS = 10_000

/** Floor: what the feature preview loaded before this limit was raised. */
const PREVIEW_MIN_ROWS = 1_000

/**
 * Cells (rows × tags) one preview page may carry. MEASURED, not guessed:
 * every cell travels as `{"value":…,"status":"…"}` JSON at ~50 bytes (a live
 * `/rows` of 3,671 rows × 19 tags was 3.49 MB), so this is ~12 MB on the wire.
 * At 10,000 rows × 22 tags (the widest real dataset here) parsing was ~60 ms
 * and every derived view under ~120 ms combined; at 400k cells it was ~0.35 s
 * and 21 MB per period change. 250k keeps every real dataset at the full
 * 10,000 rows (up to 25 tags) and trims only wider ones.
 */
const PREVIEW_CELL_BUDGET = 250_000

/**
 * How many rows to ask `/rows` for. Row count alone is the wrong bound: the
 * payload is rows × tags, and the draft leg of `datasetDraftService.rows`
 * does not send a `tags` list, so it returns every column of the artifact. A
 * wide dataset therefore gets fewer rows, never a stall — but never fewer
 * than the 1,000 the preview always had.
 */
export function previewRowLimit(tagCount: number): number {
  const byBudget = Math.floor(PREVIEW_CELL_BUDGET / Math.max(tagCount, 1))
  return Math.min(PREVIEW_MAX_ROWS, Math.max(PREVIEW_MIN_ROWS, byBudget))
}

export interface DownsampleResult<R = SensorChartRow> {
  rows: R[]
  downsampled: boolean
  /** Row count before any cut — for the "showing N of M" caption. */
  sourceCount: number
}

/**
 * Cut `rows` to at most `maxPoints` for drawing, keeping the shape and the
 * spikes.
 *
 * Plain striding would drop a one-row spike, and a spike is exactly what an
 * EDA overview exists to show. So the series is split into equal index
 * buckets and each bucket keeps the two rows where the normalised readings
 * are highest and lowest across all tags. Every bucket contributes, so time
 * coverage stays even; the first and last rows are always kept so the plotted
 * span matches the data.
 *
 * All tags share one row list (wide format), so a kept row is kept for every
 * tag. Each tag is normalised by its own global min/max first, otherwise the
 * tag with the biggest units would decide every bucket. The trade-off: a
 * spike on a quiet tag inside a bucket dominated by a louder one can still be
 * dropped. The chart caption says the view is downsampled; zooming into a
 * month is how to see full resolution.
 *
 * `read` says how to get one tag's value out of a row, so any row shape can
 * use this — the trend chart's `SensorChartRow` and the compare modal's own
 * series points both do.
 */
export function downsampleBy<R>(
  rows: R[],
  tags: string[],
  maxPoints: number,
  read: (row: R, tag: string) => number | null | undefined,
): DownsampleResult<R> {
  const n = rows.length
  if (n <= maxPoints || maxPoints < 4) {
    return { rows, downsampled: false, sourceCount: n }
  }

  // Global range per tag; a tag with no finite values or no spread gets no
  // entry and simply never wins a bucket.
  const ranges: { tag: string; min: number; span: number }[] = []
  for (const tag of tags) {
    let min = Infinity
    let max = -Infinity
    for (const row of rows) {
      const v = read(row, tag)
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (max > min) ranges.push({ tag, min, span: max - min })
  }

  // Two rows per bucket, plus the two pinned ends.
  const buckets = Math.floor((maxPoints - 2) / 2)
  const keep = new Set<number>([0, n - 1])

  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets)
    const to = Math.floor(((b + 1) * n) / buckets)
    if (from >= to) continue

    let hiIdx = from
    let loIdx = from
    let hiScore = -Infinity
    let loScore = Infinity

    for (let i = from; i < to; i++) {
      const row = rows[i]
      if (!row) continue
      let rowHi = -Infinity
      let rowLo = Infinity
      for (const { tag, min, span } of ranges) {
        const v = read(row, tag)
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        const norm = (v - min) / span
        if (norm > rowHi) rowHi = norm
        if (norm < rowLo) rowLo = norm
      }
      if (rowHi > hiScore) {
        hiScore = rowHi
        hiIdx = i
      }
      if (rowLo < loScore) {
        loScore = rowLo
        loIdx = i
      }
    }

    keep.add(hiIdx)
    keep.add(loIdx)
  }

  const kept: R[] = []
  for (const i of [...keep].sort((a, b) => a - b)) {
    const row = rows[i]
    if (row) kept.push(row)
  }
  return { rows: kept, downsampled: true, sourceCount: n }
}

/** `downsampleBy` for the trend chart's own row shape. */
export function downsampleRows(
  rows: SensorChartRow[],
  tags: string[],
  maxPoints: number,
): DownsampleResult {
  return downsampleBy(rows, tags, maxPoints, (row, tag) => {
    const v = row[tag]
    return typeof v === 'number' ? v : null
  })
}
