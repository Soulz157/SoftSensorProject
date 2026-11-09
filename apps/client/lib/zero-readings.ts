/**
 * "Zeros treated as missing" suggestion for Step 5's cleaning pipeline
 * (2026-10-19).
 *
 * Many PI tags report exactly 0 when the instrument drops out, and a 0 that
 * really means "no reading" poisons every mean, lag and rolling window built
 * on it. But 0 is also a real reading - a closed valve, a stopped pump - so
 * this never acts on its own: it names the tags whose share of exact zeros is
 * high and, on request, adds ONE ordinary `exclude` step with the band [0, 0]
 * scoped to those tags. `exclude` marks a reading inside its band Bad (value
 * kept) and already round-trips to the server (`cleaning_service._op_exclude`,
 * parity fixtures `exclude_*`), so a later fill/interpolate step imputes the
 * zeros like any other gap.
 *
 * Pure module - no React, no IO.
 */

import type { CleaningStep, Dataset } from '@/lib/preprocessing'

/** A tag is suggested when at least this share of its Good readings is 0. */
export const ZERO_SHARE_THRESHOLD = 0.05

export interface ZeroReadingTag {
  tag: string
  zeros: number
  /** Good readings counted (the denominator). */
  readings: number
  share: number
}

/** Tags whose Good readings are exactly 0 at least `threshold` of the time. */
export function zeroHeavyTags(
  dataset: Dataset,
  tags: readonly string[],
  threshold = ZERO_SHARE_THRESHOLD,
): ZeroReadingTag[] {
  const out: ZeroReadingTag[] = []
  for (const tag of tags) {
    let zeros = 0
    let readings = 0
    for (const row of dataset.rows) {
      const cell = row.cells[tag]
      if (!cell || cell.status !== 'Good' || !Number.isFinite(cell.value))
        continue
      readings++
      if (cell.value === 0) zeros++
    }
    if (readings === 0 || zeros === 0) continue
    const share = zeros / readings
    if (share >= threshold) out.push({ tag, zeros, readings, share })
  }
  return out
}

/** Whether `step` already turns `tag`'s zeros into gaps, across the whole series. */
export function excludesZeros(step: CleaningStep, tag: string): boolean {
  return (
    step.method === 'exclude' &&
    step.paramLow === 0 &&
    step.param === 0 &&
    !step.startTime &&
    !step.endTime &&
    (!step.tags || step.tags.includes(tag))
  )
}

/**
 * The zero-heavy tags this pipeline does not already handle, most zero-heavy
 * first (the notice names only the first few inline). Ties keep tag order.
 */
export function zeroSuggestions(
  dataset: Dataset,
  tags: readonly string[],
  pipeline: readonly CleaningStep[],
  threshold = ZERO_SHARE_THRESHOLD,
): ZeroReadingTag[] {
  return zeroHeavyTags(dataset, tags, threshold)
    .filter(z => !pipeline.some(step => excludesZeros(step, z.tag)))
    .map((z, index) => ({ z, index }))
    .sort((a, b) => b.z.share - a.z.share || a.index - b.index)
    .map(x => x.z)
}

/**
 * The pipeline with a zeros-as-missing step FIRST, so every fill, interpolate
 * or Drop Missing step after it sees the zeros as gaps.
 */
export function withZerosAsMissing(
  pipeline: readonly CleaningStep[],
  tags: readonly string[],
  uid: string,
): CleaningStep[] {
  if (tags.length === 0) return [...pipeline]
  return [
    {
      uid,
      category: 'outliers',
      method: 'exclude',
      paramLow: 0,
      param: 0,
      tags: [...tags],
    },
    ...pipeline,
  ]
}
