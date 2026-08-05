import type { CleaningStep } from '@/lib/preprocessing'

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
