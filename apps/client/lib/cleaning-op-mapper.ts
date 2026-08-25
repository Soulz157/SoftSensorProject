import type { CleaningStep, TagPipeline } from '@/lib/preprocessing'

/**
 * Map the wizard's local `CleaningStep[]` pipeline onto the server's
 * `CleaningOperation` request shape (DS-LAKE-005 — Step 3 Apply → draft clean
 * job).
 *
 * This is NOT a guess. `apps/python/services/cleaning_service.py`'s
 * `CLEANING_OPS` registry is keyed by the browser's own `CleaningMethod`
 * values on purpose — its comment says so directly: "Keys are the browser's
 * `CleaningMethod` values, so a saved recipe replays without translation."
 * `resolve_method()` short-circuits to an identity match whenever `op_type`
 * is already a registry key and no `method` is given, so `type: step.method`
 * needs no alias table. `param`/`paramLow` pass straight through — Python's
 * `_PARAM_ALIASES` accepts them by those exact names.
 *
 * One step becomes one operation, scoped to every tag the pipeline currently
 * applies to (Step 3.2 shares one `draft` across all `cleaningTags`).
 */
export function toCleaningOperations(
  steps: CleaningStep[],
  tags: string[],
): {
  type: string
  tags: string[]
  param?: number
  paramLow?: number
}[] {
  return steps.map(step => ({
    type: step.method,
    tags,
    ...(step.param !== undefined && { param: step.param }),
    ...(step.paramLow !== undefined && { paramLow: step.paramLow }),
  }))
}

/**
 * DS-LAKE-022-T04..T07. Flattens the wizard's FULL accumulated per-tag
 * cleaning map into one ordered operation list — what the reordered Step
 * 5's commit sends, since D4 (feature_list.preprocessing.json) requires
 * that job to replay the whole recipe against the fixed SILVER, not just
 * whatever batch was last edited.
 *
 * Groups tags by an IDENTICAL pipeline (deep-equal via JSON) rather than
 * emitting one `toCleaningOperations` call per tag — `apply_operations`
 * applies its list sequentially and in full to every tag it names
 * (`cleaning_service.py`'s own docstring example), so two tags saved with
 * the same batch (the common case: "Save Cleaned Tags" always writes one
 * shared pipeline to every tag in its batch) stay expressed as one
 * `tags: [...]` op per step, matching what a single non-reordered
 * `toCleaningOperations` call already produces for that batch. Tags with
 * an empty pipeline (never batched, or batched with zero steps) are
 * skipped — nothing to send for them.
 */
export function toCleaningOperationsFromRecord(
  pipelines: Record<string, TagPipeline>,
): {
  type: string
  tags: string[]
  param?: number
  paramLow?: number
}[] {
  const groups = new Map<string, { steps: TagPipeline; tags: string[] }>()
  for (const [tag, steps] of Object.entries(pipelines)) {
    if (steps.length === 0) continue
    const key = JSON.stringify(steps)
    const existing = groups.get(key)
    if (existing) {
      existing.tags.push(tag)
    } else {
      groups.set(key, { steps, tags: [tag] })
    }
  }
  return Array.from(groups.values()).flatMap(({ steps, tags }) =>
    toCleaningOperations(steps, tags),
  )
}
