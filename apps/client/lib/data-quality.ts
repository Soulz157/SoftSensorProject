/**
 * Pre-cleansing data-quality + correlation metrics over a raw `Dataset`.
 *
 * Pure module — no React, no IO. Mirrors the style of `lib/preprocessing.ts`.
 * Consumed by the Create-Model Phase 4 (Raw Data) panels to surface missing /
 * suspect counts and Pearson correlation *before* the Processing step.
 *
 * Quality mapping (the mock exposes `Good | Bad | Questionable`, per
 * `docs/PLAN.md` §6 — there is no explicit null/missing flag):
 *   - `Bad`         → **Missing** (unusable / null-equivalent)
 *   - `Questionable`→ **Suspect** (present but low-trust)
 */
import type { Dataset } from '@/lib/preprocessing'

export interface TagQuality {
  total: number
  good: number
  missing: number
  suspect: number
  missingPct: number
  suspectPct: number
}

export interface DatasetQuality {
  total: number
  good: number
  missing: number
  suspect: number
  missingPct: number
  suspectPct: number
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100
}

/** Per-tag Missing (Bad) / Suspect (Questionable) counts + percentages. */
export function qualityByTag(ds: Dataset): Record<string, TagQuality> {
  const out: Record<string, TagQuality> = {}
  for (const tag of ds.tags) {
    let good = 0
    let missing = 0
    let suspect = 0
    for (const row of ds.rows) {
      const cell = row.cells[tag]
      if (!cell) continue
      if (cell.status === 'Bad') missing++
      else if (cell.status === 'Questionable') suspect++
      else good++
    }
    const total = good + missing + suspect
    out[tag] = {
      total,
      good,
      missing,
      suspect,
      missingPct: pct(missing, total),
      suspectPct: pct(suspect, total),
    }
  }
  return out
}

/** Unified per-tag "Bad Data" row count = Bad (missing) + Questionable (suspect). */
export function badDataByTag(ds: Dataset): Record<string, number> {
  const q = qualityByTag(ds)
  const out: Record<string, number> = {}
  for (const tag of ds.tags) {
    const t = q[tag]
    out[tag] = t ? t.missing + t.suspect : 0
  }
  return out
}

/** Per-tag Bad Data breakdown for the sidebar detail popover:
 *  bad = Bad (null) cells, questionable = Questionable (missing-value) cells. */
export function badDataDetailByTag(
  ds: Dataset,
): Record<string, { bad: number; questionable: number }> {
  const q = qualityByTag(ds)
  const out: Record<string, { bad: number; questionable: number }> = {}
  for (const tag of ds.tags) {
    const t = q[tag]
    out[tag] = { bad: t?.missing ?? 0, questionable: t?.suspect ?? 0 }
  }
  return out
}

export type TagSeverity = 'clean' | 'suspect' | 'missing'

/** Worst-case severity for a tag's list-item status dot: Missing beats Suspect beats clean. */
export function tagSeverity(q: TagQuality): TagSeverity {
  if (q.missing > 0) return 'missing'
  if (q.suspect > 0) return 'suspect'
  return 'clean'
}

/** Dataset-wide Missing / Suspect totals across all tag cells. */
export function datasetQuality(ds: Dataset): DatasetQuality {
  let good = 0
  let missing = 0
  let suspect = 0
  for (const row of ds.rows) {
    for (const tag of ds.tags) {
      const cell = row.cells[tag]
      if (!cell) continue
      if (cell.status === 'Bad') missing++
      else if (cell.status === 'Questionable') suspect++
      else good++
    }
  }
  const total = good + missing + suspect
  return {
    total,
    good,
    missing,
    suspect,
    missingPct: pct(missing, total),
    suspectPct: pct(suspect, total),
  }
}

export interface RowQuality {
  /** Rows containing ≥1 Bad (Missing) cell. */
  missingRows: number
  /** Rows containing ≥1 Questionable (Suspect) cell. */
  suspectRows: number
}

/** Count rows with any Missing / Suspect cell (for the KPI sub-lines). */
export function rowQuality(ds: Dataset): RowQuality {
  let missingRows = 0
  let suspectRows = 0
  for (const row of ds.rows) {
    let hasMissing = false
    let hasSuspect = false
    for (const tag of ds.tags) {
      const status = row.cells[tag]?.status
      if (status === 'Bad') hasMissing = true
      else if (status === 'Questionable') hasSuspect = true
    }
    if (hasMissing) missingRows++
    if (hasSuspect) suspectRows++
  }
  return { missingRows, suspectRows }
}

export interface TagDistribution {
  mean: number
  median: number
  mode: number
  std: number
  min: number
  max: number
  range: number
  /**
   * Good-cell count backing the numbers above. A zero-count row's other
   * fields are all zeros, which is otherwise indistinguishable from a
   * genuine zero reading — a caller that must tell "no data" apart from
   * "0.00" (e.g. rendering `—`, matching `PerTagStatsPanel`'s convention for
   * a null server stat) checks this instead of `mean === 0`.
   */
  count: number
}

/**
 * Mean / median / mode / sample std-dev over a tag's `Good` cells. Median =
 * middle of the sorted values (avg of the two middles for even counts). Mode =
 * most frequent value (ties → smallest); since continuous readings rarely repeat,
 * when every value is unique the mode is just the smallest value. Returns zeros
 * when the tag has no Good cells. (Same mean/std basis as `tagStats` in
 * `lib/precleanse.ts`, plus median/mode — kept here so the outlier basis is untouched.)
 */
export function tagDistribution(ds: Dataset, tag: string): TagDistribution {
  const values: number[] = []
  for (const row of ds.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good') values.push(cell.value)
  }
  const n = values.length
  if (n === 0)
    return {
      mean: 0,
      median: 0,
      mode: 0,
      std: 0,
      min: 0,
      max: 0,
      range: 0,
      count: 0,
    }

  const mean = values.reduce((a, b) => a + b, 0) / n

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  const median =
    n % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0)

  // Mode over sorted values: track the longest run; ties keep the smaller value
  // (sorted ascending, so the first-seen max run wins).
  let mode = sorted[0] ?? 0
  let bestCount = 0
  let runValue = sorted[0]
  let runCount = 0
  for (const v of sorted) {
    if (v === runValue) {
      runCount++
    } else {
      runValue = v
      runCount = 1
    }
    if (runCount > bestCount) {
      bestCount = runCount
      mode = v
    }
  }

  const std =
    n < 2
      ? 0
      : Math.sqrt(
          values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1),
        )

  const min = sorted[0] ?? 0
  const max = sorted[n - 1] ?? 0

  return { mean, median, mode, std, min, max, range: max - min, count: n }
}

export interface CorrelationMatrix {
  tags: string[]
  /** `matrix[i][j]` = Pearson r between `tags[i]` and `tags[j]` in [-1, 1]. */
  matrix: number[][]
}

export interface TagPair {
  a: string
  b: string
  r: number
}

/** Pearson r over the `Good` values two tags share on the same timestamp. */
function pearson(ds: Dataset, tagA: string, tagB: string): number {
  const xs: number[] = []
  const ys: number[] = []
  for (const row of ds.rows) {
    const a = row.cells[tagA]
    const b = row.cells[tagB]
    if (!a || !b || a.status !== 'Good' || b.status !== 'Good') continue
    xs.push(a.value)
    ys.push(b.value)
  }
  const n = xs.length
  if (n < 2) return 0

  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0
    const y = ys[i] ?? 0
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
    syy += y * y
  }
  const numerator = n * sxy - sx * sy
  const denominator = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
  if (denominator === 0) return 0
  const r = numerator / denominator
  // Clamp to guard against FP drift just outside [-1, 1].
  return Math.max(-1, Math.min(1, r))
}

/** Symmetric Pearson matrix; diagonal is 1. */
export function pearsonMatrix(ds: Dataset): CorrelationMatrix {
  const { tags } = ds
  const matrix: number[][] = tags.map(() => tags.map(() => 0))
  for (let i = 0; i < tags.length; i++) {
    matrix[i]![i] = 1
    for (let j = i + 1; j < tags.length; j++) {
      const r = pearson(ds, tags[i]!, tags[j]!)
      matrix[i]![j] = r
      matrix[j]![i] = r
    }
  }
  return { tags, matrix }
}

/**
 * Distinct tag pairs with |r| ≥ `threshold`, strongest first. Threshold 0.8
 * matches the ">80% / <-80%" highlight rule from the Phase 4 spec.
 */
export function topCorrelations(
  m: CorrelationMatrix,
  threshold = 0.8,
): TagPair[] {
  const pairs: TagPair[] = []
  for (let i = 0; i < m.tags.length; i++) {
    for (let j = i + 1; j < m.tags.length; j++) {
      const r = m.matrix[i]?.[j] ?? 0
      if (Math.abs(r) >= threshold) {
        pairs.push({ a: m.tags[i]!, b: m.tags[j]!, r })
      }
    }
  }
  return pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r))
}

/**
 * The tag most correlated (by |Pearson r|) with `tag`, excluding itself.
 * Unlike `topCorrelations` (only pairs ≥ threshold), this always returns the
 * argmax partner regardless of strength — used to pick a sensible default
 * X axis for a single-tag scatter view. Returns null when `tag` isn't in the
 * matrix or there's no other tag to compare against.
 */
export function mostCorrelatedPartner(
  m: CorrelationMatrix,
  tag: string,
): string | null {
  const i = m.tags.indexOf(tag)
  if (i === -1 || m.tags.length < 2) return null
  let best: string | null = null
  let bestAbs = -1
  for (let j = 0; j < m.tags.length; j++) {
    if (j === i) continue
    const r = Math.abs(m.matrix[i]?.[j] ?? 0)
    if (r > bestAbs) {
      bestAbs = r
      best = m.tags[j]!
    }
  }
  return best
}

export interface HistogramBin {
  binStart: number
  binEnd: number
  /** Bin midpoint — the x-position used to render the bar / reference lines. */
  mid: number
  count: number
}

/**
 * Equal-width frequency histogram over a tag's `Good` cells. `binCount` bins
 * spanning [min, max] of the observed values; the last bin's upper edge is
 * inclusive (a value === max lands in the final bin). Returns [] when the
 * tag has fewer than 2 distinct Good values (nothing meaningful to bin).
 */
export function histogramBins(
  ds: Dataset,
  tag: string,
  binCount = 12,
  domain?: { min: number; max: number },
): HistogramBin[] {
  const values: number[] = []
  for (const row of ds.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good') values.push(cell.value)
  }
  if (values.length < 2) return []

  const min = domain ? domain.min : Math.min(...values)
  const max = domain ? domain.max : Math.max(...values)
  const width = (max - min) / binCount
  if (width === 0) return []

  const counts = new Array<number>(binCount).fill(0)
  for (const v of values) {
    const idx = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((v - min) / width)),
    )
    counts[idx]!++
  }

  return counts.map((count, i) => ({
    binStart: min + i * width,
    binEnd: min + (i + 1) * width,
    mid: min + (i + 0.5) * width,
    count,
  }))
}

export interface KdePoint {
  x: number
  /** Probability density at `x` — not a count. Use `densityToCount` to overlay on a histogram's count axis. */
  y: number
}

/**
 * Gaussian-kernel density estimate over a tag's `Good` cells, sampled evenly
 * across `domain`. Bandwidth via Silverman's rule of thumb
 * (`1.06 * std * n^(-1/5)`, same sample-std basis as `tagDistribution`).
 * Returns [] when there's nothing meaningful to estimate (fewer than 2
 * values, zero variance, or a degenerate/empty domain).
 */
export function kdeEstimate(
  values: number[],
  domain: { min: number; max: number },
  sampleCount = 100,
): KdePoint[] {
  const n = values.length
  if (n < 2 || domain.max <= domain.min) return []

  const mean = values.reduce((a, b) => a + b, 0) / n
  const std = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1),
  )
  if (std === 0) return []

  const h = 1.06 * std * Math.pow(n, -1 / 5)
  if (h <= 0) return []

  const gaussian = (u: number) =>
    Math.exp(-(u * u) / 2) / Math.sqrt(2 * Math.PI)

  const step = (domain.max - domain.min) / (sampleCount - 1)
  const points: KdePoint[] = []
  for (let k = 0; k < sampleCount; k++) {
    const x = domain.min + k * step
    let sum = 0
    for (const v of values) sum += gaussian((x - v) / h)
    points.push({ x, y: sum / (n * h) })
  }
  return points
}

/** Rescale a KDE density value onto a histogram's count axis (expected count in a `binWidth`-wide bin ≈ n·f(x)·binWidth). */
export function densityToCount(
  density: number,
  n: number,
  binWidth: number,
): number {
  return density * n * binWidth
}

export interface BoxplotStats {
  min: number
  q1: number
  median: number
  /** Arithmetic mean of the tag's Good values (drawn as the dashed mean line). */
  mean: number
  q3: number
  max: number
  /** Whisker caps — 1.5×IQR rule, clamped to the observed data range. */
  whiskerLow: number
  whiskerHigh: number
  outliers: number[]
}

const EMPTY_BOXPLOT_STATS: BoxplotStats = {
  min: 0,
  q1: 0,
  median: 0,
  mean: 0,
  q3: 0,
  max: 0,
  whiskerLow: 0,
  whiskerHigh: 0,
  outliers: [],
}

/** Linear-interpolated percentile over an already-sorted array (0 ≤ p ≤ 1). */
function quantile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 1) return sorted[0]!
  const idx = p * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const loVal = sorted[lo]!
  const hiVal = sorted[hi]!
  return loVal + (hiVal - loVal) * (idx - lo)
}

/**
 * Five-number summary + 1.5×IQR outlier set over a tag's `Good` cells.
 * Quartiles via linear-interpolated percentile on the sorted values (same
 * sorted-ascending convention as `tagDistribution`'s median). Returns
 * all-zero stats with an empty outlier list when the tag has 0 Good cells.
 */
export function tagBoxplotStats(ds: Dataset, tag: string): BoxplotStats {
  const values: number[] = []
  for (const row of ds.rows) {
    const cell = row.cells[tag]
    if (cell && cell.status === 'Good') values.push(cell.value)
  }
  if (values.length === 0) return EMPTY_BOXPLOT_STATS

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0)
  const iqr = q3 - q1
  const whiskerLow = Math.max(min, q1 - 1.5 * iqr)
  const whiskerHigh = Math.min(max, q3 + 1.5 * iqr)
  const outliers = sorted.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr)
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length

  return { min, q1, median, mean, q3, max, whiskerLow, whiskerHigh, outliers }
}
