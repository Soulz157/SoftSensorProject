/**
 * Critical tags (2026-10-19): the source tags an engineer marks in Step 1 as
 * the ones the model must never lose. Stored by tag NAME, like the target, so
 * the list follows a rename and drops a deleted row - see the Step 1 tag
 * table. The target (Y) is never critical: it has its own rules.
 *
 * What it drives today is the Preset range cutoff suggestion:
 *   critical -> Clip: an out-of-range reading is clamped to the bound, so the
 *               row and its Good status survive and the model keeps the input.
 *   other    -> Exclude: an out-of-range reading is most likely a bad reading,
 *               so it becomes a hole for a later step to impute, instead of
 *               being pinned to the edge of the range.
 *
 * Pure module - no React, no IO.
 */

import type { RangeAction } from '@/lib/range-cutoff'

export interface RangeActionSuggestion {
  action: RangeAction
  reason: string
}

export function isCriticalTag(
  tag: string,
  criticalTags: readonly string[],
): boolean {
  return criticalTags.includes(tag)
}

export function suggestRangeAction(
  tag: string,
  criticalTags: readonly string[],
): RangeActionSuggestion {
  return isCriticalTag(tag, criticalTags)
    ? {
        action: 'clip',
        reason:
          'Critical tag: Clip clamps an out-of-range reading to the bound, so the row stays Good and the model never loses this input.',
      }
    : {
        action: 'exclude',
        reason:
          'Not a critical tag: a reading outside its range is most likely a bad reading, so Exclude turns it into a hole for imputation instead of pinning it to the bound.',
      }
}

/** Adds the tag, or removes it when it is already critical. */
export function toggleCriticalTag(
  criticalTags: readonly string[],
  tag: string,
): string[] {
  return criticalTags.includes(tag)
    ? criticalTags.filter(t => t !== tag)
    : [...criticalTags, tag]
}

/** Follows a rename; a no-op when `from` is not critical. */
export function renameCriticalTag(
  criticalTags: readonly string[],
  from: string,
  to: string,
): string[] {
  if (!criticalTags.includes(from) || from === to) return [...criticalTags]
  const renamed = criticalTags.map(t => (t === from ? to : t))
  return renamed.filter((t, i) => renamed.indexOf(t) === i)
}

/** Drops the given names (deleted rows, or a tag that just became the target). */
export function withoutCriticalTags(
  criticalTags: readonly string[],
  names: Iterable<string>,
): string[] {
  const drop = new Set(names)
  return criticalTags.filter(t => !drop.has(t))
}
