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

const DAY = 86_400_000

/**
 * Human-readable span between an artifact's `startTime`/`endTime`, as
 * returned by `GET .../artifacts/:artifactId/metadata` — the FOOTER bounds
 * of the real committed artifact, not a client-held row sample. Replaces
 * the earlier `datasetTimeSpanLabel(ds)`, which read the first/last
 * timestamp of a client `Dataset` and was quietly wrong the moment that
 * frame was a bounded preview rather than the whole artifact (DS-LAKE-013).
 * Shared by the detail sheet and the grid card so both report the same
 * number for the same dataset.
 */
export function artifactTimeSpanLabel(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return '—'
  const a = new Date(start)
  const b = new Date(end)
  if (Number.isNaN(+a) || Number.isNaN(+b)) return '—'
  const days = Math.max(1, Math.round((+b - +a) / DAY))
  return days >= 365
    ? `${(days / 365).toFixed(1)} yr`
    : days >= 30
      ? `${Math.round(days / 30)} mo`
      : `${days} d`
}
