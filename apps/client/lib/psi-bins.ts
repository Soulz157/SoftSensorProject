import type { ColumnBins } from '@/services/model-monitoring'

/**
 * MODEL-SERVE-001-T16. Shared bin-resolution for `PsiBinChart` and
 * `PsiBinTable` (monitoring/psi/). `binMode` changes what `edges` MEANS —
 * continuous holds `binCount + 1` boundaries, bin `i` is
 * `[edges[i], edges[i+1])` (last bin closed on the right); categorical
 * holds `edges.length === binCount` entries, each one IS the bin (one per
 * trained value). Duplicating that branch into both the chart and the
 * table is exactly how an off-by-one renders a plausible WRONG
 * engineering-unit range — the silent, believable failure this whole
 * display rebuild exists to prevent. Resolved here once; both components
 * only ever read the result.
 */
export interface PsiBinRow {
  key: string
  /** Bare chart-axis label (`B1`, `B2`, …) — DELIBERATELY not the real
   *  range. `PsiBinTable`'s `rangeLabel` carries that; a bare label on the
   *  chart plus real ranges in the table beside it is T13's own chosen
   *  split, not a shortcut past naming the range anywhere. */
  label: string
  /** The real engineering-unit range (continuous) or trained value
   *  (categorical) — NOT optional per T13: "bare B1..B10 labels tell a
   *  process engineer nothing". */
  rangeLabel: string
  refPct: number
  curPct: number
  refCount: number
  curCount: number
}

function formatEdgeValue(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—'
}

/** Per-bin reference vs. current percentages, resolved once from raw
 *  counts — never re-derived per consumer, so the chart and the table can
 *  never disagree about what a bin contains. */
export function resolvePsiBins(bins: ColumnBins): PsiBinRow[] {
  const { binMode, binCount, edges, refCounts, liveCounts, liveInRangeTotal } =
    bins
  const refTotal = refCounts.reduce((a, b) => a + b, 0)
  const rows: PsiBinRow[] = []

  for (let i = 0; i < binCount; i++) {
    const refCount = refCounts[i] ?? 0
    const curCount = liveCounts[i] ?? 0
    // `edges[i]` is `number | undefined` under strict indexed access — a
    // genuinely missing edge (a malformed/short array) falls through to
    // `formatEdgeValue`'s own `Number.isFinite` check and renders '—',
    // rather than being treated as a type error here. It should never
    // actually happen (edges is echoed byte-for-byte from the frozen
    // training-time array), but this is not the place to assert that.
    const rangeLabel =
      binMode === 'categorical'
        ? formatEdgeValue(edges[i] ?? NaN)
        : `[${formatEdgeValue(edges[i] ?? NaN)}, ${formatEdgeValue(edges[i + 1] ?? NaN)}${
            i === binCount - 1 ? ']' : ')'
          }`

    rows.push({
      key: `bin-${i}`,
      label: `B${i + 1}`,
      rangeLabel,
      refPct: refTotal > 0 ? (refCount / refTotal) * 100 : 0,
      curPct: liveInRangeTotal > 0 ? (curCount / liveInRangeTotal) * 100 : 0,
      refCount,
      curCount,
    })
  }

  return rows
}

export interface PsiOverflowSide {
  label: '<lo' | '>hi'
  curCount: number
  /** Percentage of `liveTotal` (the column's FULL live population,
   *  including overflow) — a DIFFERENT denominator from `PsiBinRow.curPct`
   *  above, which is a percentage of `liveInRangeTotal` (bins only). The
   *  two must never be silently mixed in one column — see
   *  `PsiBinTable`'s own footnote, which states both denominators rather
   *  than letting a reader assume they match. */
  curPct: number
}

/**
 * `null` for a categorical tag — `psi.py`'s own bucketing has no
 * "out of range" concept there (the nearest trained value is always a
 * match, by construction), so `below`/`above` are structurally always
 * zero and a flanking bar for them would be noise, not information.
 */
export function resolvePsiOverflow(
  bins: ColumnBins,
  liveTotal: number,
): { below: PsiOverflowSide; above: PsiOverflowSide } | null {
  if (bins.binMode === 'categorical') return null

  return {
    below: {
      label: '<lo',
      curCount: bins.below,
      curPct: liveTotal > 0 ? (bins.below / liveTotal) * 100 : 0,
    },
    above: {
      label: '>hi',
      curCount: bins.above,
      curPct: liveTotal > 0 ? (bins.above / liveTotal) * 100 : 0,
    },
  }
}
