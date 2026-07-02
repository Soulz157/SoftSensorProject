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
