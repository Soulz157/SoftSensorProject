/**
 * MODEL-FLOW-021-T01 — the comparability rules a set of training runs must
 * obey before any of them share a table, a sorted column or a chart axis.
 *
 * MOVED, NOT WRITTEN. Every function here was declared privately inside
 * `phase-4-model-selection.tsx` (MODEL-FLOW-018-T05) and is reproduced
 * unchanged; the move exists because Step 3's own run comparison
 * (`training-config/run-comparison-panel.tsx`) needs the SAME rules, and a
 * second derivation of "are these two runs comparable" is exactly how two
 * surfaces start disagreeing about what a number means.
 *
 * Pure module — no React, no IO (the `lib/run-selection.ts` pattern).
 *
 * The two rules, kept deliberately separate:
 *
 * 1. A DIFFERENT TARGET IS NEVER SORTED INTO THE SAME COLUMN. Handled
 *    structurally, by `groupByTarget` — not by a note, because no wording
 *    makes two targets' RMSEs comparable.
 * 2. DIFFERENCES THAT CHANGE WHAT A NUMBER DESCRIBES BUT NOT WHETHER IT CAN
 *    BE READ (dataset artifact, feature spec, split shape) are NAMED on the
 *    row by `comparabilityNote` and block nothing.
 */

import type { ModelTrainingRunListItem } from '@/services/model-draft'

/** A field off an untyped Json column, narrowed rather than asserted.
 *  `splitSpec`/`metrics` are `unknown`-shaped end to end (schema.prisma). */
function numberField(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

/**
 * MODEL-FLOW-018-T05. CV-ness is keyed off `run.cvFoldsKey`, the SAME
 * signal a row's own metric column already trusts — not off
 * `splitSpec.method`. Advisor review (2026-09-04) caught that keying this
 * off `splitSpec` alone lets the two signals disagree: a row could show
 * "CV RMSE" (per `cvFoldsKey`) while this function called it a plain
 * chronological split (per `splitSpec`), silently dropping the exact
 * category-error note D2/finding-6 exist to surface. `splitSpec` is now
 * only the SECONDARY signal, read for `n_splits`/`ratio` detail once
 * `cvFoldsKey` has already decided CV vs. not.
 *
 * `n_splits` is read from `run.metrics` first (what `SingleRunSummary`
 * already trusts for this field), falling back to `splitSpec.n_splits`.
 *
 * `splitSpec.method` narrowed off `unknown`, not the client's own
 * `ModelRunSplitSpec` (services/model-draft.ts) — that interface only
 * declares 'chronological' | 'chronological_windowed', but a live CV run's
 * own splitSpec is `{ method: 'cv_expanding', n_splits }`
 * (model-run-launch.authorized.service.ts:184) with NO `ratio` at all.
 * Mirrors the backend's own `isPlainObject`-then-narrow pattern
 * (model-draft.authorized.service.ts's `extractCvConfig`) rather than
 * widening the shared type here — that type is also `splitPercentFromRun`'s
 * (lib/run-params.ts) own parameter, used unconditionally by RunParamsPanel
 * for EVERY run including CV ones. Recorded as its own ledger finding (not
 * fixed here): three separate workarounds now exist because of this one gap.
 */
export function splitShapeKey(run: ModelTrainingRunListItem): string {
  if (run.cvFoldsKey !== null) {
    const n =
      numberField(run.metrics, 'n_splits') ??
      numberField(run.splitSpec, 'n_splits')
    return `cv:${n ?? '?'}`
  }
  const s = run.splitSpec
  const method = stringField(s, 'method') ?? 'unknown'
  const ratio = numberField(s, 'ratio')
  return `${method}:${ratio ?? '?'}`
}

export function splitShapeLabel(run: ModelTrainingRunListItem): string {
  if (run.cvFoldsKey !== null) {
    const n =
      numberField(run.metrics, 'n_splits') ??
      numberField(run.splitSpec, 'n_splits')
    return n !== null ? `${n}-fold cross-validation` : 'cross-validation'
  }
  const s = run.splitSpec
  if (!s || typeof s !== 'object') return 'an unrecorded split'
  const method = stringField(s, 'method') ?? 'unknown'
  const ratio = numberField(s, 'ratio')
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const methodLabel =
    method === 'chronological_windowed'
      ? 'windowed chronological'
      : 'chronological'
  return pct !== null
    ? `a ${pct}/${100 - pct} ${methodLabel} split`
    : `a ${methodLabel} split`
}

/**
 * MODEL-FLOW-018-T05, per openDecision D2 (resolved 2026-09-03): a
 * DIFFERENT target is never sorted into the same column — that is handled
 * structurally, by grouping (below), not here. This is the SECOND half of
 * D2: differences that are legitimate but change what a number DESCRIBES
 * (dataset artifact, feature spec, split shape) do not block selection —
 * they are named on the row, one sentence, so the number is read correctly
 * rather than assumed comparable. Symmetric by construction: an axis is
 * named on EVERY row in the group when that axis isn't uniform across the
 * group, not diffed against one arbitrarily-chosen "reference" row — there
 * is no reason one row's shape is more canonical than another's.
 */
export function comparabilityNote(
  run: ModelTrainingRunListItem,
  group: ModelTrainingRunListItem[],
): string | null {
  if (group.length <= 1) return null

  const parts: string[] = []
  if (group.some(r => r.goldArtifactId !== run.goldArtifactId)) {
    parts.push('a different dataset artifact')
  }
  if (group.some(r => r.featureSpecKey !== run.featureSpecKey)) {
    parts.push('a different feature spec')
  }
  if (group.some(r => splitShapeKey(r) !== splitShapeKey(run))) {
    parts.push(splitShapeLabel(run))
  }

  if (parts.length === 0) return null
  return `Not the same comparison as the other rows here — ${parts.join(', ')}.`
}

/**
 * MODEL-FLOW-018-T05, per openDecision D2. Two different targets never
 * share one comparison — grouped into SEPARATE sections, one grid each,
 * rather than one flat list a reader could scan as if RMSE meant the same
 * thing in every row. Insertion order (JS `Map`) matches the run list's own
 * server order, so a single-target draft — the common case — gets exactly
 * the same visual result as an ungrouped list: one group, no header (a
 * header naming the one target every row already repeats would be pure
 * noise).
 */
export function groupByTarget(
  runs: ModelTrainingRunListItem[],
): [string, ModelTrainingRunListItem[]][] {
  const groups = new Map<string, ModelTrainingRunListItem[]>()
  for (const run of runs) {
    const group = groups.get(run.targetY)
    if (group) {
      group.push(run)
    } else {
      groups.set(run.targetY, [run])
    }
  }
  return Array.from(groups.entries())
}
