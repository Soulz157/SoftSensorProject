/**
 * Shared synthetic input grid for the parity-fixture generators.
 *
 * Extracted from `parity-fixtures.test.ts` (DS-LAKE-005B-D-T02) so the chart
 * parity generator (`chart-parity-fixtures.test.ts`) exercises the SAME
 * awkward grid — ragged missingness, leading/trailing Bad cells with no fill
 * donor, injected outliers — rather than forking a second one that drifts
 * from it over time. Deliberately not itself a `*.test.ts` file: Vitest's
 * `include` glob only matches `*.{test,spec}.{ts,tsx}`, so this module is
 * invisible to the test runner and exists purely as an import target.
 */
import type { Dataset, DataRow } from '@/lib/preprocessing'
import { tagMeta } from '@/lib/mock-readings'

/** Tags chosen to exercise every distinct precision: 1, 2, 0, and the ?? 2 default. */
export const TAGS = ['TI-101', 'VI-202', 'FI-404', 'XX-999'] as const

export const ROW_COUNT = 40

/** Deterministic LCG — fixtures must never depend on Math.random or the clock. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export function precisionOf(tag: string): number {
  return tagMeta(tag)?.precision ?? 2
}

export function round(value: number, precision: number): number {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

export const BASELINE: Record<string, number> = {
  'TI-101': 72,
  'VI-202': 4.5,
  'FI-404': 120,
  'XX-999': 10,
}

/**
 * A fixed grid with deliberately awkward content:
 *   - Bad and Questionable cells at known indices (drives drop/fill/interpolate)
 *   - a leading Bad cell (no forward-fill donor) and a trailing Bad cell (no
 *     backward-fill donor) — where status flips but the value cannot
 *   - extreme outliers (drives zscore / iqr / clip)
 *   - one all-Good column so pass-through behaviour is covered too
 */
export function buildInput(): Dataset {
  const rand = lcg(20260801)
  const rows: DataRow[] = []

  for (let i = 0; i < ROW_COUNT; i++) {
    const ts = new Date(Date.UTC(2026, 5, 22, 0, i)).toISOString()
    const cells: DataRow['cells'] = {}

    for (const [tagIndex, tag] of TAGS.entries()) {
      const base = BASELINE[tag] ?? 0
      let value = base + (rand() - 0.5) * 4
      let status: 'Good' | 'Bad' | 'Questionable' = 'Good'

      if (tag !== 'XX-999') {
        // Offset per tag so missingness is RAGGED, not a shared mask. With
        // identical masks a `drop` that applies one tag's marks to every column
        // is indistinguishable from one that unions across tags, and a mean-fill
        // computed globally instead of per-tag could still pass.
        const offset = tagIndex * 3
        if ((i + offset) % 11 === 5) status = 'Bad'
        else if ((i + offset) % 13 === 7) status = 'Questionable'
        if (i === 0 && tag === 'TI-101') status = 'Bad' // no forward donor
        if (i === ROW_COUNT - 1 && tag === 'VI-202') status = 'Bad' // no backward donor
      }

      // Extreme values so IQR fences and z-thresholds actually fire.
      if (i === 9) value = base * 5
      if (i === 27) value = base * -3

      cells[tag] = { value: round(value, precisionOf(tag)), status }
    }
    rows.push({ timestamp: ts, cells })
  }

  return { tags: [...TAGS], rows }
}

export const PRECISION: Record<string, number> = Object.fromEntries(
  TAGS.map(t => [t, precisionOf(t)]),
)
