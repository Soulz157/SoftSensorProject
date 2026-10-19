import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'

/**
 * Phase 4 (Model Selection) chart filter. Pure: no React, no IO.
 *
 * The overlay charts draw every candidate by default; the filter lets the
 * user hide some. Each model keeps the SAME label and colour whether or not
 * others are hidden — numbering or colouring by position among the visible
 * series would repaint a line the moment its neighbour is hidden.
 */

export interface SeriesStyle {
  label: string
  /** Index into the chart palette, fixed by the model's place in the FULL list. */
  colorIndex: number
}

export interface FilterableCandidate {
  runId: string | null
  algorithm: string
}

/**
 * One style per candidate that has a run, in list order. An algorithm that
 * appears more than once is numbered ("Ridge Regression #2") by its position
 * among the runs of that algorithm, so the number never depends on what the
 * filter hides.
 */
export function seriesStylesFor(
  candidates: readonly FilterableCandidate[],
): Map<string, SeriesStyle> {
  const withRun = candidates.filter(
    (c): c is FilterableCandidate & { runId: string } => c.runId !== null,
  )
  const totals = new Map<string, number>()
  for (const c of withRun) {
    totals.set(c.algorithm, (totals.get(c.algorithm) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const styles = new Map<string, SeriesStyle>()
  withRun.forEach((c, index) => {
    const nth = (seen.get(c.algorithm) ?? 0) + 1
    seen.set(c.algorithm, nth)
    const name = ALGORITHM_LABELS[c.algorithm as Algorithm] ?? c.algorithm
    styles.set(c.runId, {
      label: (totals.get(c.algorithm) ?? 0) > 1 ? `${name} #${nth}` : name,
      colorIndex: index,
    })
  })
  return styles
}

/**
 * Toggle one model in or out of the charts. Refuses to hide the last visible
 * model: an empty chart would read as "nothing to compare", which is not true.
 */
export function toggleHiddenRun(
  hidden: ReadonlySet<string>,
  runId: string,
  allRunIds: readonly string[],
): Set<string> {
  const next = new Set(hidden)
  if (next.has(runId)) {
    next.delete(runId)
    return next
  }
  const visibleAfter = allRunIds.filter(id => id !== runId && !next.has(id))
  if (visibleAfter.length === 0) return next
  next.add(runId)
  return next
}

/** The candidates the charts draw: every one the filter has not hidden. A
 *  hidden id that no longer names a candidate is ignored. */
export function visibleForCharts<T extends FilterableCandidate>(
  candidates: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  return candidates.filter(c => c.runId === null || !hidden.has(c.runId))
}
