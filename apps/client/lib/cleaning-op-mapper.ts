import type { ConditionalRule } from '@/lib/precleanse'
import type { CleaningStep, TagPipeline } from '@/lib/preprocessing'

/** The server request shape one step becomes. */
export interface MappedCleaningOperation {
  type: string
  tags: string[]
  param?: number
  paramLow?: number
  startTime?: string
  endTime?: string
}

/**
 * DS-LAKE-032-D04. Picker stamp (`yyyy-MM-ddTHH:mm`) → the server's naive
 * wall-clock string. The end is pushed to the last instant of its minute so
 * the server's inclusive bound matches the browser's minute-inclusive
 * `inStepWindow` — same convention as `monthWindow`'s `23:59:59.999999`.
 */
function serverStamp(stamp: string, edge: 'start' | 'end'): string {
  const minute = stamp.replace('T', ' ').slice(0, 16)
  return edge === 'start' ? `${minute}:00` : `${minute}:59.999999`
}

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
): MappedCleaningOperation[] {
  return steps.flatMap(step => {
    // DS-LAKE-032-D03. A step scoped to some tags reaches only those still in
    // this batch. An EMPTY intersection is skipped, never sent: python reads
    // an empty `tags` as every tag, the exact opposite of what was asked.
    const opTags = step.tags ? tags.filter(t => step.tags!.includes(t)) : tags
    if (opTags.length === 0) return []
    return [
      {
        type: step.method,
        tags: opTags,
        ...(step.param !== undefined && { param: step.param }),
        ...(step.paramLow !== undefined && { paramLow: step.paramLow }),
        ...(step.startTime && {
          startTime: serverStamp(step.startTime, 'start'),
        }),
        ...(step.endTime && { endTime: serverStamp(step.endTime, 'end') }),
      },
    ]
  })
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
): MappedCleaningOperation[] {
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

/**
 * DS-LAKE-038. The Preset range card's enabled rules, as server operations.
 *
 * A preset range is two `ConditionalRule`s per tag (`< min`, `> max`), and
 * conditional rules never reach the server on their own - only the cleaning
 * pipelines are sent. So the card's choice has to ride along as operations or
 * the saved dataset would silently ignore it:
 *
 *   clip            -> `clip`           clamp to the bound, row and Good kept
 *   exclude (`mark`) -> `range_exclude` reading marked Bad, value kept - the
 *                                       toolkit's Exclude, outside the window
 *
 * Grouped per TAG and per ACTION: the Conditional tab still lets someone set a
 * different action on each bound of a pair, and the two bounds then cannot
 * share one operation. Order is by tag then action so the request is stable.
 *
 * Exclude is stored as the rule action `mark` (Bad, value kept). A preset
 * rule left with `drop` by an earlier build is sent as Exclude too, so it
 * never disagrees with the preview.
 */
export function toPresetRangeOperations(
  rules: ConditionalRule[],
): MappedCleaningOperation[] {
  const byKey = new Map<
    string,
    { tag: string; type: 'clip' | 'range_exclude'; min?: number; max?: number }
  >()
  for (const rule of rules) {
    if (!rule.enabled || rule.source !== 'preset-range') continue
    if (rule.value === '' || rule.lower) continue
    if (rule.op !== '<' && rule.op !== '>') continue
    const type =
      rule.action === 'clip'
        ? 'clip'
        : rule.action === 'mark' || rule.action === 'drop'
          ? 'range_exclude'
          : null
    if (!type) continue
    const key = `${rule.tag}\u0000${type}`
    const entry = byKey.get(key) ?? { tag: rule.tag, type }
    if (rule.op === '<') entry.min = rule.value
    else entry.max = rule.value
    byKey.set(key, entry)
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.tag.localeCompare(b.tag) || a.type.localeCompare(b.type))
    .map(({ tag, type, min, max }) => ({
      type,
      tags: [tag],
      ...(min !== undefined && { paramLow: min }),
      ...(max !== undefined && { param: max }),
    }))
}
