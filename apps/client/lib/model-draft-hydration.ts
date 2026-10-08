import {
  ALGORITHMS,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'

/**
 * Pure derivations for restoring a server-side `ModelDraft` into the wizard's
 * `mp*` atoms (MODEL-FLOW-010-T08). Kept out of the hook so the two rules that
 * actually bite — a stored value that is no longer a valid choice, and a
 * target the user deleted while editing the dataset — are testable without a
 * jotai context or a router.
 */

/** Narrows the draft's `algorithm` column, which Postgres stores as plain text. */
export function isAlgorithm(value: string): value is Algorithm {
  return (ALGORITHMS as readonly string[]).includes(value)
}

/**
 * Narrows the draft's `hyperparameters` JSON column. Anything that is not a
 * scalar the grid can render is dropped rather than passed through: the atom
 * is typed `Record<string, HyperparamValue>` and a nested object reaching an
 * input would render `[object Object]` and then be PATCHed back as one.
 */
export function asHyperparams(value: unknown): Record<string, HyperparamValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, HyperparamValue> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      raw === null ||
      typeof raw === 'number' ||
      typeof raw === 'string' ||
      typeof raw === 'boolean'
    ) {
      out[key] = raw
    }
  }
  return out
}

export interface ResumedTarget {
  /** What `mpTargetVariableAtom` should be set to. */
  targets: string[]
  /**
   * The stored target that no longer exists in the dataset, if any — the
   * caller must SAY this, not silently swallow it.
   */
  droppedTarget: string | null
}

/**
 * Reconciles a draft's stored target against the dataset's CURRENT tag list
 * (MODEL-FLOW-010-T07/V04).
 *
 * Editing a dataset does not remove it — the `Dataset` row keeps its id, and
 * only `currentArtifactId` (and possibly the tag list) moves. So `datasetId`
 * stays valid and must not be cleared. What can genuinely go stale is the
 * TARGET: an edit that dropped that tag leaves a `targetY` that no longer
 * exists, and carrying it forward fails at run creation with a pyarrow
 * `No match for FieldRef.Name` error that names a column and explains nothing.
 *
 * A dataset with no tags at all is treated as "cannot tell" rather than "the
 * target is gone" — an empty list is what an unloaded dataset looks like, and
 * reporting a drop for it would be a lie the user cannot act on.
 */
export function reconcileTarget(
  targetY: string | null,
  datasetTags: string[],
): ResumedTarget {
  if (!targetY) return { targets: [], droppedTarget: null }
  if (datasetTags.length === 0) {
    return { targets: [targetY], droppedTarget: null }
  }
  if (datasetTags.includes(targetY)) {
    return { targets: [targetY], droppedTarget: null }
  }
  return { targets: [], droppedTarget: targetY }
}

/**
 * The draft stores `splitRatio` as a FRACTION (0.5-0.95); the wizard atom is a
 * PERCENTAGE. Converted here, at the one boundary, rather than at each call
 * site — the same rule the API DTO and `useModelDraftSync` both state going
 * the other way. A null (never configured) falls back to the wizard default.
 */
export function splitRatioToPercent(splitRatio: number | null): number {
  if (splitRatio === null || Number.isNaN(splitRatio)) return 80
  return Math.round(splitRatio * 100)
}
