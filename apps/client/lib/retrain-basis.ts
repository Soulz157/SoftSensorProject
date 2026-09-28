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
 */
export function describeEvalBasis(
  basis: EvalBasis | null,
  versionLabel: string | null,
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
      return `New version on the new data you set aside${range ? `, ${range}` : ''}, ${rows}`
  }
}

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
 * The "Trained on: …" line — AUGMENT_DATA reads "existing data up to
 * <date> (N rows) + <dataset> (M rows), K repeated rows removed"; NEW_DATA_ONLY
 * reads "<dataset> only (M rows)". Null when the composition was never
 * recorded (a retrain from before this feature) — the caller shows nothing
 * rather than a fabricated line.
 */
export function describeTrainingComposition(
  strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY',
  composition: TrainingComposition | null,
  datasetLabel: string,
): string | null {
  if (!composition) return null
  const { baseTrainRowCount, newTrainRowCount, dedupeDropped, cutTimestamp } =
    composition
  if (strategy === 'NEW_DATA_ONLY') {
    if (newTrainRowCount === null) return null
    return `Trained on: ${datasetLabel} only (${newTrainRowCount.toLocaleString()} rows)`
  }
  if (baseTrainRowCount === null || newTrainRowCount === null) return null
  const cut = cutTimestamp ? toDateOnly(cutTimestamp) : null
  const dropped =
    dedupeDropped !== null && dedupeDropped > 0
      ? `, ${dedupeDropped.toLocaleString()} repeated row${dedupeDropped === 1 ? '' : 's'} removed`
      : ''
  return (
    `Trained on: existing data${cut ? ` up to ${cut}` : ''} ` +
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
