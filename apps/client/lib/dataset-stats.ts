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
import type { DraftCorrelationResult } from '@/services/dataset-draft'
import type { ArtifactTagColumnStats } from '@/services/dataset-version'

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

/**
 * Orders an artifact's `column_stats.json` sidecar entries by the DATASET's
 * own tag list, not the sidecar's key order (JSON insertion order is an
 * accident of the writer). Tags absent from the sidecar are dropped rather
 * than rendered as an all-dash row — a legacy sidecar can legitimately
 * predate a tag. Shared by `DatasetDetailSheet` and the Model wizard's Step 2
 * Dataset Review (MODEL-FLOW-010) so both agree on row order for the same
 * artifact.
 */
export function perTagStatsOrdered(
  tags: string[],
  stats: Record<string, ArtifactTagColumnStats> | null | undefined,
): ArtifactTagColumnStats[] {
  if (!stats) return []
  return tags
    .map(tag => stats[tag])
    .filter((s): s is ArtifactTagColumnStats => Boolean(s))
}

export interface CorrelatedArtifactPair {
  a: string
  b: string
  r: number
}

/**
 * Ranks a server-resolved correlation matrix (`POST .../correlation`) into
 * pairs by |r|, strongest first — the endpoint returns a resolved tag list +
 * a full matrix (DS-LAKE-005B-D-T05b), NOT a ranked pair list, so the
 * ranking happens client-side. Cheap by construction: the server already
 * hard-caps the matrix at `topK` columns, so this is at most topK²/2
 * iterations over data already in memory, not a client-side Pearson pass
 * over a frame. Shared by `DatasetDetailSheet` and the Model wizard's Step 2
 * Dataset Review (MODEL-FLOW-010).
 */
export function topCorrelatedArtifactPairs(
  correlation: DraftCorrelationResult | null,
  limit = 5,
): CorrelatedArtifactPair[] {
  if (!correlation) return []
  const { tags: resolved, matrix } = correlation
  const pairs: CorrelatedArtifactPair[] = []
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const r = matrix[i]?.[j]
      if (typeof r === 'number' && Number.isFinite(r)) {
        pairs.push({ a: resolved[i]!, b: resolved[j]!, r })
      }
    }
  }
  // A strong negative relationship is exactly as interesting as a strong
  // positive one to whoever opens this panel.
  return pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, limit)
}
