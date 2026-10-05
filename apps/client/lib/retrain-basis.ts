/**
 * MODEL-SERVE-019-T04. Plain-language labels for a retrain metric's own
 * evaluation basis (`EvalBasis`) and its training composition
 * (`TrainingComposition`).
 *
 * User rule (2026-09-28): the words "incumbent", "frozen", "holdout",
 * "frame", "merged test split", "regime", "evalSet", "dedupe", "cut
 * timestamp" and "basis" never appear in text this module returns. Those
 * stay as internal enum/field names on the wire and in code comments; every
 * function here turns one into a sentence a user reads, using the real
 * version number (`v{n}`) wherever one is known rather than "the current
 * version" or "the incumbent".
 *
 * Pure module — no React, no IO.
 */

import type { EvalBasis, TrainingComposition } from '@/services/model-retrain'

/** `2026-06-01T00:00:00Z` -> `2026-06-01`. Never re-parsed through `Date` —
 *  a plain string slice keeps the exact calendar day the server measured,
 *  with no timezone shift. */
function toDateOnly(iso: string): string {
  return iso.slice(0, 10)
}

function rangeText(from: string | null, to: string | null): string | null {
  if (from && to) return `${toDateOnly(from)} – ${toDateOnly(to)}`
  if (from) return `from ${toDateOnly(from)}`
  if (to) return `up to ${toDateOnly(to)}`
  return null
}

/**
 * The plain sentence naming WHAT a figure was computed on and how many rows
 * — e.g. "New version on v3's test data, 2026-06-01 – 2026-07-01, 40
 * rows". Returns the `unavailableReason` verbatim (already plain — the
 * server writes these strings for direct display) when the basis carries no
 * usable range/row count, so a figure never renders "0 rows" or a blank.
 *
 * `versionLabel` names the CURRENT production version (e.g. "v3"); omit it
 * only when it is genuinely unknown.
 *
 * `subject` names WHOSE figure this is. Every other frame is inherently
 * one-sided (`INCUMBENT_TEST_SPLIT` is always the current version's own
 * split, `FROZEN_INCUMBENT_TEST`/`MERGED_TEST_SPLIT` are always the new
 * version's), so the wording could stay hardcoded. MODEL-SERVE-021 makes
 * `NEW_DATA_WINDOW` the exception: it is now used for BOTH the new version's
 * figure (the window it trained around) and the current version's figure
 * (the same window, scored fresh) — the one pairing that never existed
 * before this change. Defaults to `'candidate'`, the frame's original and
 * still most common subject.
 */
export function describeEvalBasis(
  basis: EvalBasis | null,
  versionLabel: string | null,
  subject: 'candidate' | 'incumbent' = 'candidate',
): string {
  if (!basis) return 'Not recorded for this retrain'
  if (basis.rowCount === null) {
    return basis.unavailableReason ?? 'Not recorded for this retrain'
  }
  const range = rangeText(basis.from, basis.to)
  const rows = `${basis.rowCount.toLocaleString()} row${basis.rowCount === 1 ? '' : 's'}`
  const v = versionLabel ?? 'the current version'
  switch (basis.frame) {
    case 'INCUMBENT_TEST_SPLIT':
      return `Current version (${v})’s test data${range ? `, ${range}` : ''}, ${rows}`
    case 'FROZEN_INCUMBENT_TEST':
      return `New version on ${v}’s test data${range ? `, ${range}` : ''}, ${rows}`
    case 'MERGED_TEST_SPLIT':
      return `New version on its own test data (existing + new)${range ? `, ${range}` : ''}, ${rows}`
    case 'NEW_DATA_WINDOW':
      return subject === 'incumbent'
        ? `Current version (${v}) on the new data you set aside${range ? `, ${range}` : ''}, ${rows}`
        : `New version on the new data you set aside${range ? `, ${range}` : ''}, ${rows}`
  }
}

/**
 * The CURRENT version's side of the paired "Scored on" block — written to
 * sit under a "Current v3" label, so it does not repeat the version as its
 * subject the way `describeEvalBasis` does. It states WHEN the figure was
 * produced, which is what a reader cannot otherwise tell: on its own test
 * split the current version's score is the one stored when it was trained
 * (AUGMENT_DATA), while on the new-data window it was scored fresh on the
 * very rows the new version was scored on (NEW_DATA_ONLY, MODEL-SERVE-021).
 * Same fallbacks as `describeEvalBasis`; any other frame defers to it.
 */
export function describeCurrentBasis(
  basis: EvalBasis | null,
  versionLabel: string | null,
): string {
  if (!basis) return 'Not recorded for this retrain'
  if (basis.rowCount === null) {
    return basis.unavailableReason ?? 'Not recorded for this retrain'
  }
  const range = rangeText(basis.from, basis.to)
  const rows = `${basis.rowCount.toLocaleString()} row${basis.rowCount === 1 ? '' : 's'}`
  const tail = [range, rows].filter(Boolean).join(' · ')
  switch (basis.frame) {
    case 'INCUMBENT_TEST_SPLIT':
      return `Its own test data, scored when ${versionLabel ?? 'it'} was trained · ${tail}`
    case 'NEW_DATA_WINDOW':
      return `The same new-data window as the new version, scored during this retrain · ${tail}`
    default:
      return describeEvalBasis(basis, versionLabel, 'incumbent')
  }
}

/** The current version's figure always plays one role in the comparison. */
export const CURRENT_USED_FOR = 'Used to compare with the new version'

/** What a figure is FOR, in one short plain phrase — never the raw
 *  `usedFor` code. */
export function describeUsedFor(
  usedFor: EvalBasis['usedFor'] | null,
): string | null {
  switch (usedFor) {
    case 'RANK_CANDIDATES':
      return 'Used to pick the best new version'
    case 'COMPARE_TO_PRODUCTION':
      return 'Used to compare with the current version'
    case 'REPORT_ONLY':
      return 'Reported on its own — not used to rank or compare'
    default:
      return null
  }
}

/**
 * The "Trained on: …" line. It states what the model was actually FIT on
 * when the run recorded its split, because the combined data and the fit are
 * not the same thing: the newest rows (the new data) fall in the test split, so
 * a model can be "existing + new data" in name and fit on the old rows alone in
 * fact. With a recorded fit: "Trained on: N rows up to <date>", plus "None of
 * the new data was used to train it — it was used only for testing" when the
 * persisted facts settle that. Without one (a job from before the fit was
 * recorded) it says "Built from: …", describing what the combined data
 * CONTAINS without claiming it was the training set. Null when nothing was
 * recorded — the caller shows nothing rather than a fabricated line.
 */
export function describeTrainingComposition(
  strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY',
  composition: TrainingComposition | null,
  datasetLabel: string,
): string | null {
  if (!composition) return null
  const {
    baseTrainRowCount,
    newTrainRowCount,
    dedupeDropped,
    cutTimestamp,
    fitRowCount,
    fitUpTo,
    newDataUsedInFit,
  } = composition

  // What the model was actually FIT on, when the run recorded its own split.
  // The combined data and the fit differ: the new rows are the newest, so a
  // chronological split puts them in the test set. Describing the artifact as
  // "trained on" would then say something false.
  if (fitRowCount !== null) {
    const upTo = fitUpTo ? ` up to ${toDateOnly(fitUpTo)}` : ''
    const fit = `Trained on: ${fitRowCount.toLocaleString()} rows${upTo}`
    return newDataUsedInFit === false
      ? `${fit}. None of the new data was used to train it \u2014 it was used only for testing`
      : fit
  }

  // No fit recorded (a job from before it was): say what the combined data
  // CONTAINS, in words that do not claim it was the training set.
  if (strategy === 'NEW_DATA_ONLY') {
    if (newTrainRowCount === null) return null
    return `Built from: ${datasetLabel} only (${newTrainRowCount.toLocaleString()} rows)`
  }
  if (baseTrainRowCount === null || newTrainRowCount === null) return null
  const cut = cutTimestamp ? toDateOnly(cutTimestamp) : null
  const dropped =
    dedupeDropped !== null && dedupeDropped > 0
      ? `, ${dedupeDropped.toLocaleString()} repeated row${dedupeDropped === 1 ? '' : 's'} removed`
      : ''
  return (
    `Built from: existing data${cut ? ` up to ${cut}` : ''} ` +
    `(${baseTrainRowCount.toLocaleString()} rows) + ${datasetLabel} ` +
    `(${newTrainRowCount.toLocaleString()} rows)${dropped}`
  )
}

/** The legacy Versions-tab label for a stored `retrainStrategy` string —
 *  historical rows only; never used for a live trigger. */
export function legacyStrategyLabel(retrainStrategy: string | null): string {
  switch (retrainStrategy) {
    case 'AUGMENT_DATA':
      return 'existing + new data'
    case 'NEW_DATA_ONLY':
      return 'new data only'
    case 'KEEP_EXISTING':
      return 'same data as before'
    default:
      return 'same data as before'
  }
}
