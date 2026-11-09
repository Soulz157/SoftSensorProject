/**
 * Which series a trend-chart tooltip lists (2026-10-19). With ~100 tags the
 * stock tooltip grew one row per tag - taller than the chart and the window -
 * and a Recharts tooltip cannot be scrolled (it never receives the pointer).
 * So it lists a bounded set instead: focused tags first, then the rest in
 * series order, and says how many it left out.
 *
 * Pure module - no React, no IO.
 */

/** Rows a tooltip lists before it summarises the rest as "+N more". */
export const TREND_TOOLTIP_MAX_ROWS = 16
/** Above this many rows the list flows into two columns. */
export const TREND_TOOLTIP_TWO_COLUMNS_FROM = 8

export interface TrendTooltipEntry {
  name: string
  value: number
  color: string | undefined
}

export interface TrendTooltipRows {
  shown: TrendTooltipEntry[]
  /** Series with a reading at this point that are not listed. */
  hidden: number
  twoColumns: boolean
}

export function trendTooltipRows(
  entries: readonly TrendTooltipEntry[],
  focused: readonly string[] = [],
  max = TREND_TOOLTIP_MAX_ROWS,
): TrendTooltipRows {
  const withValue = entries.filter(e => Number.isFinite(e.value))
  const rank = (e: TrendTooltipEntry) => {
    const i = focused.indexOf(e.name)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  // Stable: focused tags in focus order, everything else in series order.
  const ordered = withValue
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(x => x.entry)
  const shown = ordered.slice(0, Math.max(0, max))
  return {
    shown,
    hidden: ordered.length - shown.length,
    twoColumns: shown.length > TREND_TOOLTIP_TWO_COLUMNS_FROM,
  }
}
