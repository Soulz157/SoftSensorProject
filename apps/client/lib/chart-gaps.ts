/**
 * Evaluation charts that close a cut-out gap. When a validation range is
 * removed from the middle of a dataset, the test rows sit on both sides of it;
 * on a TIME axis the cut stays as an empty stretch and `connectNulls` draws one
 * long segment across it. A SEQUENCE axis (row order 0..n-1) plots the rows one
 * after another instead, and the gaps found here mark where they are not
 * adjacent in time. Tick labels and tooltips still read each row's real time.
 */

export interface GapRow {
  /** Epoch ms. */
  t: number
}

export interface AxisGap {
  /** Row position of the first row AFTER the gap. */
  index: number
  /** Time of the last row before the gap. */
  from: number
  /** Time of the first row after the gap. */
  to: number
}

/** A step longer than this many median steps is a gap, not sampling jitter. */
const GAP_FACTOR = 3

/**
 * Rows with their position `x`, plus every gap. The median is taken over
 * positive steps only, so a repeated timestamp cannot zero it. Fewer than three
 * rows, or no positive step, has no meaningful cadence: no gaps.
 */
export function sequenceAxis<T extends GapRow>(
  rows: readonly T[],
  factor: number = GAP_FACTOR,
): { rows: (T & { x: number })[]; gaps: AxisGap[] } {
  const indexed = rows.map((row, x) => ({ ...row, x }))
  if (rows.length < 3) return { rows: indexed, gaps: [] }

  const steps: number[] = []
  const times = rows.map(row => row.t)
  for (let i = 1; i < times.length; i += 1) {
    const step = (times[i] as number) - (times[i - 1] as number)
    if (step > 0) steps.push(step)
  }
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]
  if (median === undefined) return { rows: indexed, gaps: [] }

  const gaps: AxisGap[] = []
  for (let i = 1; i < times.length; i += 1) {
    const before = times[i - 1] as number
    const after = times[i] as number
    if (after - before > median * factor) {
      gaps.push({ index: i, from: before, to: after })
    }
  }
  return { rows: indexed, gaps }
}

/**
 * Position of the first row at or after time `t` — where a fold cut (a time)
 * lands on a sequence axis. Past the last row it is the last row's position.
 */
export function indexAtOrAfter(rows: readonly GapRow[], t: number): number {
  const found = rows.findIndex(row => row.t >= t)
  return found === -1 ? Math.max(0, rows.length - 1) : found
}
