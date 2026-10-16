/**
 * Geometry of the Residual Analysis chart's ±1/2/3 SD guardrails (2026-10-16).
 *
 * The bands are drawn around 0 — a residual is the distance from a perfect
 * prediction, so a point outside them IS the signal, a biased model included.
 * What made them collapse into one line, and what this module fixes:
 * - under a few points the SD is 0 or meaningless and every band sat on the
 *   zero line: below MIN_BAND_POINTS points or at SD 0 the bands use the
 *   version's own test-split residual SD (`referenceSd`) instead, and are
 *   hidden only when there is none;
 * - the y-axis scaled to the points only, so far-off points squashed the
 *   bands: the axis always spans 0 ± DOMAIN_SD·SD as well as the data;
 * - one very far point stretched the axis: a point further than CLIP_SD·SD
 *   from the bulk of the data is clipped to the edge and reported as an
 *   outlier (drawn as an arrow, real value in the tooltip).
 *
 * The clip window is measured from the DATA (a robust centre), never from 0:
 * measured from 0, every point of a consistently biased model would be an
 * "outlier" and the series would vanish into edge arrows.
 *
 * Pure module — no React, no IO.
 */

export const MIN_BAND_POINTS = 3
/** The y-axis always shows at least 0 ± this many SD. */
export const DOMAIN_SD = 3.5
/** A point further than this many SD from the bulk of the data is clipped. */
export const CLIP_SD = 6
const PAD = 0.08

export interface ResidualPoint {
  t: number
  value: number
}

export interface ResidualOutlier extends ResidualPoint {
  edge: 'top' | 'bottom'
  /** Where the arrow is drawn: the clip limit on its side. */
  drawAt: number
}

export type ResidualBand =
  | {
      show: true
      sd: number
      /** `live`: the SD of this range's own points. `reference`: the
       *  version's test-split residual SD, used while the range has too few
       *  points (or no spread) for its own. */
      sdSource: 'live' | 'reference'
      /** Explicit y-axis domain; outliers fall outside it. */
      domain: [number, number]
      outliers: ResidualOutlier[]
    }
  | {
      show: false
      /** Why no bands: too few points, or no spread. */
      reason: 'few-points' | 'no-spread'
      n: number
    }

export function residualBand(
  points: readonly ResidualPoint[],
  liveSd: number,
  referenceSd: number | null = null,
): ResidualBand {
  const finite = points.filter(p => Number.isFinite(p.value))
  const n = finite.length
  const liveOk = n >= MIN_BAND_POINTS && Number.isFinite(liveSd) && liveSd > 0
  const refOk =
    referenceSd !== null && Number.isFinite(referenceSd) && referenceSd > 0
  if (!liveOk && !(refOk && n > 0)) {
    return {
      show: false,
      reason: n < MIN_BAND_POINTS ? 'few-points' : 'no-spread',
      n,
    }
  }
  const sd = liveOk ? liveSd : referenceSd!
  const sdSource = liveOk ? ('live' as const) : ('reference' as const)

  // The bulk of the data, robust to the very points being clipped: the
  // median places a window, and the centre is the mean of what is inside it.
  const median = medianOf(finite.map(p => p.value))
  const inWindow = finite.filter(
    p => Math.abs(p.value - median) <= CLIP_SD * sd,
  )
  const dataCenter =
    inWindow.reduce((acc, p) => acc + p.value, 0) / inWindow.length
  const clipLo = dataCenter - CLIP_SD * sd
  const clipHi = dataCenter + CLIP_SD * sd

  const inside = finite.filter(p => p.value >= clipLo && p.value <= clipHi)
  const outliers: ResidualOutlier[] = finite
    .filter(p => p.value < clipLo || p.value > clipHi)
    .map(p =>
      p.value > clipHi
        ? { ...p, edge: 'top' as const, drawAt: clipHi }
        : { ...p, edge: 'bottom' as const, drawAt: clipLo },
    )

  const values = inside.map(p => p.value)
  let lo = Math.min(-DOMAIN_SD * sd, ...values)
  let hi = Math.max(DOMAIN_SD * sd, ...values)
  // Arrows sit ON the clip limit, so the axis reaches it on their side.
  for (const o of outliers) {
    lo = Math.min(lo, o.drawAt)
    hi = Math.max(hi, o.drawAt)
  }
  const pad = (hi - lo) * PAD

  return { show: true, sd, sdSource, domain: [lo - pad, hi + pad], outliers }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Share of points in each band, counted OUTWARD from 0 so each figure
 * describes the region its own label sits in (k=1: within 1 SD of 0; k=2:
 * between 1 and 2 SD; ...). The same 0 the bands are drawn around.
 */
export function bandCoverage(
  values: readonly number[],
  sd: number,
): Record<1 | 2 | 3, { up: number; down: number }> | null {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0 || !(sd > 0)) return null
  const n = finite.length
  const out = {} as Record<1 | 2 | 3, { up: number; down: number }>
  for (const k of [1, 2, 3] as const) {
    const inner = (k - 1) * sd
    const limit = k * sd
    let up = 0
    let down = 0
    for (const v of finite) {
      if (v > inner && v <= limit) up++
      else if (v < -inner && v >= -limit) down++
    }
    out[k] = { up: (up / n) * 100, down: (down / n) * 100 }
  }
  return out
}

/** How many points sit beyond ±3 SD of 0 — the summary shown when the bands
 *  alone cannot show it (a biased model far outside them). */
export function beyondBandCounts(
  values: readonly number[],
  sd: number,
): { above: number; below: number; n: number } {
  const finite = values.filter(v => Number.isFinite(v))
  let above = 0
  let below = 0
  if (sd > 0) {
    for (const v of finite) {
      if (v > 3 * sd) above++
      else if (v < -3 * sd) below++
    }
  }
  return { above, below, n: finite.length }
}
