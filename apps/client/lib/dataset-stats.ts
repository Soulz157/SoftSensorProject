/**
 * Dataset-level KPI aggregation for the Datasets page card + detail slide-over.
 *
 * Pure module — no React, no IO. Composes the per-tag primitives in
 * `lib/data-quality.ts` (`tagDistribution`, `pearsonMatrix`, `topCorrelations`)
 * into a single "typical value" summary for a whole `Dataset`. Mean/Median/SD
 * are per-tag by nature, so the card-level numbers are the **average across the
 * dataset's numeric tags** — a rough at-a-glance summary, not a single-series
 * statistic (labelled `avg` in the UI so it isn't misread).
 */
import type { Dataset } from '@/lib/preprocessing'
import { classifyColumns } from '@/lib/preprocessing'
import {
  tagDistribution,
  pearsonMatrix,
  topCorrelations,
  type TagPair,
} from '@/lib/data-quality'

export interface DatasetKpis {
  /** Mean of each numeric tag's mean, averaged across tags. */
  mean: number
  /** Mean of each numeric tag's median, averaged across tags. */
  median: number
  /** Mean of each numeric tag's sample std-dev, averaged across tags. */
  sd: number
}

const EMPTY_KPIS: DatasetKpis = { mean: 0, median: 0, sd: 0 }

/**
 * Average mean / median / std-dev across all numeric tags. Each tag's stats
 * come from `tagDistribution` (Good cells only); the dataset value is the
 * arithmetic mean of the per-tag values. Returns zeros when there are no
 * numeric tags / rows.
 */
export function datasetKpis(ds: Dataset): DatasetKpis {
  const { numeric } = classifyColumns(ds)
  if (numeric.length === 0 || ds.rows.length === 0) return EMPTY_KPIS

  let mean = 0
  let median = 0
  let sd = 0
  for (const tag of numeric) {
    const d = tagDistribution(ds, tag)
    mean += d.mean
    median += d.median
    sd += d.std
  }
  const n = numeric.length
  return { mean: mean / n, median: median / n, sd: sd / n }
}

/**
 * Tag pairs ranked by |Pearson r|, strongest first, capped at `limit`.
 * Threshold 0 = rank every pair (not just the ≥0.8 highlights), then slice —
 * so the detail view can surface the top-N most correlated tags regardless of
 * absolute strength.
 */
export function topCorrelatedPairs(ds: Dataset, limit = 10): TagPair[] {
  if (ds.tags.length < 2) return []
  return topCorrelations(pearsonMatrix(ds), 0).slice(0, limit)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Human-readable span between the first and last row timestamps — the wall-clock
 * window the dataset covers. Returns '—' when there are fewer than 2 rows.
 * `buildRawDataset` emits rows sorted ascending, so first/last bound the range.
 */
export function datasetTimeSpanLabel(ds: Dataset): string {
  const { rows } = ds
  if (rows.length < 2) return '—'
  const first = Date.parse(rows[0]!.timestamp)
  const last = Date.parse(rows[rows.length - 1]!.timestamp)
  const ms = Math.abs(last - first)
  if (ms >= DAY) return `${Math.round(ms / DAY)}d`
  if (ms >= HOUR) return `${Math.round(ms / HOUR)}h`
  return `${Math.round(ms / MINUTE)}m`
}
