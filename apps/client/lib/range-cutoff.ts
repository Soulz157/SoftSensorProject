import type { ParsedRange } from '@/lib/feature-preset'
import type { Dataset } from '@/lib/preprocessing'
import type { ConditionalAction, ConditionalRule } from '@/lib/precleanse'

/**
 * Unit reconciliation between a preset's quoted engineering range and the
 * tag's own reported unit (DS-LAKE-020-T03). Pure — no atoms, no React.
 *
 * The preset's range unit is not guaranteed to match the tag's: one real
 * preset quotes FIC114A-D/I.PV in kg/hr while FIC204.PV is quoted in tph
 * within the SAME config. Applying a bound without reconciling units is
 * wrong by 1000x and every resulting value still looks plausible — never
 * auto-convert without showing the engineer both the quoted and applied
 * numbers, and never guess at an unrecognized unit pair.
 */

export type UnitVerdict =
  | 'dimensionless'
  | 'match'
  | 'converted'
  | 'unknown-unit'
  | 'tag-unit-unknown'

export interface RangeUnitReconciliation {
  verdict: UnitVerdict
  /**
   * The bound to actually apply, in the tag's own unit. Null when the
   * verdict refuses to apply (`unknown-unit`, or `tag-unit-unknown` with a
   * real quoted unit) — the caller must never fall back to the raw quoted
   * number in that case.
   */
  applied: { min: number | null; max: number | null } | null
  /** Multiplier from quoted to applied, present only for `converted`. */
  factor: number | null
  quotedUnit: string | null
  tagUnit: string | null
}

/**
 * Canonical key for a unit string, collapsing the case/spacing/synonym
 * variants observed in the reference workbook (`kg/hr` | `kg/h` | `kgph`,
 * `tph` | `t/h`, `c` | `°c` | `degc` | `oc` - ROC COLD's Unit column writes
 * degrees Celsius as `oC`). Units with no synonym-table entry
 * still normalize (trimmed, lower-cased, spaces/degree-signs stripped) so
 * two differently-formatted but equivalent strings still compare equal.
 */
function normalizeUnit(unit: string): string {
  const compact = unit.trim().toLowerCase().replace(/[°\s]/g, '')
  const synonyms: Record<string, string> = {
    'kg/hr': 'kg/h',
    kgph: 'kg/h',
    tph: 't/h',
    degc: 'c',
    oc: 'c',
  }
  return synonyms[compact] ?? compact
}

/**
 * Known scale factors ONLY. `quotedKey->tagKey`. Anything not listed here is
 * an unknown conversion and must be refused, never guessed — the 1000x error
 * this guards against produces plausible numbers, so a silent conversion is
 * as dangerous as a silent non-conversion.
 */
const KNOWN_FACTORS: Record<string, number> = {
  'kg/h->t/h': 1 / 1000,
  't/h->kg/h': 1000,
  'kg->t': 1 / 1000,
  't->kg': 1000,
}

export function reconcileRangeUnit(
  parsed: Pick<ParsedRange, 'min' | 'max' | 'unit'>,
  tagUnit: string | null,
): RangeUnitReconciliation {
  const quotedUnit = parsed.unit
  const base = { quotedUnit, tagUnit }

  // `"0.85-1.2"` — dimensionless, applies as-is regardless of the tag's unit.
  if (quotedUnit === null) {
    return {
      ...base,
      verdict: 'dimensionless',
      applied: { min: parsed.min, max: parsed.max },
      factor: null,
    }
  }

  // CSV-uploaded and manually inserted tags have no PI record, so no unit —
  // never guess that a quoted unit matches an unknown one.
  if (!tagUnit) {
    return { ...base, verdict: 'tag-unit-unknown', applied: null, factor: null }
  }

  const quotedKey = normalizeUnit(quotedUnit)
  const tagKey = normalizeUnit(tagUnit)

  if (quotedKey === tagKey) {
    return {
      ...base,
      verdict: 'match',
      applied: { min: parsed.min, max: parsed.max },
      factor: null,
    }
  }

  const factor = KNOWN_FACTORS[`${quotedKey}->${tagKey}`]
  if (factor === undefined) {
    return { ...base, verdict: 'unknown-unit', applied: null, factor: null }
  }

  return {
    ...base,
    verdict: 'converted',
    applied: {
      min: parsed.min === null ? null : parsed.min * factor,
      max: parsed.max === null ? null : parsed.max * factor,
    },
    factor,
  }
}

/**
 * Training-set guards for the enabled range cutoffs, at selection time
 * (DS-LAKE-020-T06). Same shape as `describeHoldoutSelection` (lib/holdout.ts)
 * — numbered guards, `{ refusals, warnings }` — fired while toggles are being
 * flipped, not at Save and not at training.
 */

/**
 * `images/trainer/train.py`'s own hard floor (train.py:433-438, "Only {n}
 * rows have a Good target — too few to split"). Copy-only mirror, same
 * precedent as `holdout.ts`'s `MIN_LABELLED_ROWS`, so the UI number can't
 * drift out of sync with the check that actually enforces it.
 */
const MIN_LABELLED_ROWS = 30

/**
 * DS-LAKE-038. What an enabled range does to an out-of-range reading. `clip`
 * clamps it to the bound (the row and its Good status survive); `exclude`
 * marks it Bad and keeps its value - the cleaning toolkit's Exclude Range,
 * applied outside the window - so a later fill step can impute it.
 */
export type RangeAction = 'clip' | 'exclude'

/** The rule action a range action is stored as: Exclude is `mark` (Bad, value kept). */
export function toRuleAction(action: RangeAction): ConditionalAction {
  return action === 'clip' ? 'clip' : 'mark'
}

/** The range action a preset-range rule reads as; any non-clip is Exclude. */
export function rangeActionOf(
  rule: Pick<ConditionalRule, 'action'>,
): RangeAction {
  return rule.action === 'clip' ? 'clip' : 'exclude'
}

export interface RangeBound {
  tag: string
  min: number
  max: number
  /** Absent = `exclude`: rules saved before Clip existed marked the reading Bad. */
  action?: RangeAction
}

export interface RangeCutoffGuardInput {
  /** The frame the enabled cutoffs would apply against. */
  dataset: Dataset
  /** Currently enabled preset-range bounds, one entry per tag. */
  activeBounds: RangeBound[]
  /** Null until Step 4 — the labelled-row guard cannot run without it. */
  targetTag: string | null
}

export interface RangeCutoffGuardResult {
  refusals: string[]
  warnings: string[]
  remainingRows: number
  /** Null when `targetTag` is not yet chosen — never a guessed count. */
  remainingLabelledRows: number | null
}

export function describeRangeCutoffSelection({
  dataset,
  activeBounds,
  targetTag,
}: RangeCutoffGuardInput): RangeCutoffGuardResult {
  const refusals: string[] = []
  const warnings: string[] = []

  if (activeBounds.length === 0) {
    return {
      refusals,
      warnings,
      remainingRows: dataset.rows.length,
      remainingLabelledRows: null,
    }
  }

  // A clip keeps every row and its Good status, so only EXCLUDE bounds (which
  // mark readings Bad) can shrink the training set. Counting clips here would
  // warn about rows that are fine.
  const excludeBounds = activeBounds.filter(
    b => (b.action ?? 'exclude') === 'exclude',
  )
  if (excludeBounds.length === 0) {
    return {
      refusals,
      warnings,
      remainingRows: dataset.rows.length,
      remainingLabelledRows: null,
    }
  }

  let remainingRows = 0
  let remainingLabelled = 0
  for (const row of dataset.rows) {
    const violated = excludeBounds.some(({ tag, min, max }) => {
      const cell = row.cells[tag]
      return (
        cell &&
        cell.status === 'Good' &&
        Number.isFinite(cell.value) &&
        (cell.value < min || cell.value > max)
      )
    })
    if (violated) continue
    remainingRows++
    if (targetTag) {
      const target = row.cells[targetTag]
      if (target && target.status === 'Good' && Number.isFinite(target.value)) {
        remainingLabelled++
      }
    }
  }

  // Guard 1 — REMAINING ROWS. Every enabled bound is an AND, so this can
  // shed far more than any single tag's impact number suggests.
  if (dataset.rows.length > 0 && remainingRows === 0) {
    refusals.push(
      'Every row would lose a reading to the enabled range cutoffs — at ' +
        'least one bound is too aggressive for this frame.',
    )
  }

  // Guard 2 — REMAINING LABELLED ROWS. Mirrors holdout.ts guard 2: the real
  // check needs a target tag, not chosen until Step 4. Warn about the gap
  // rather than claim a check that cannot run here.
  if (!targetTag) {
    warnings.push(
      `Target tag isn't chosen yet, so the remaining labelled-row count ` +
        `can't be checked from here — training refuses runs with fewer ` +
        `than ${MIN_LABELLED_ROWS} labelled rows. Revisit this once a ` +
        'target is set in Step 4.',
    )
  } else if (remainingLabelled < MIN_LABELLED_ROWS) {
    warnings.push(
      `Only ${remainingLabelled} labelled row(s) would remain after the ` +
        `enabled range cutoffs — training refuses runs with fewer than ` +
        `${MIN_LABELLED_ROWS}.`,
    )
  }

  return {
    refusals,
    warnings,
    remainingRows,
    remainingLabelledRows: targetTag ? remainingLabelled : null,
  }
}

/** `30.000000001` -> `30`: bounds come out of a unit conversion, so tidy the noise. */
function fmtBound(n: number): string {
  return String(Number(n.toPrecision(10)))
}

/**
 * The WINDOW a range keeps, read left to right: `30 ≤ x ≤ 100 kg/h`. The card
 * shows what survives untouched rather than the bounds' two rules, because a
 * reader asks "is my value inside?". `≤` on both sides is deliberate: a value
 * exactly ON a bound is in range under either action.
 */
export function formatKeptWindow(
  applied: { min: number | null; max: number | null },
  unit: string | null,
): string {
  const { min, max } = applied
  const suffix = unit ? ` ${unit}` : ''
  if (min !== null && max !== null) {
    return `${fmtBound(min)} ≤ x ≤ ${fmtBound(max)}${suffix}`
  }
  if (min !== null) return `x ≥ ${fmtBound(min)}${suffix}`
  if (max !== null) return `x ≤ ${fmtBound(max)}${suffix}`
  return 'no bounds'
}

/**
 * The enabled preset-range rules as one bound per (tag, action).
 *
 * A pair is `< min` and `> max`; each is grouped with the other bound of the
 * SAME tag AND action, so a pair whose two rules were given different actions
 * in the Conditional tab stays two bounds, each open on one side. The legacy
 * `mark` and `drop` actions both read as `exclude`.
 */
export function presetRangeBounds(rules: ConditionalRule[]): RangeBound[] {
  const byKey = new Map<string, RangeBound>()
  for (const rule of rules) {
    if (!rule.enabled || rule.source !== 'preset-range') continue
    if (rule.value === '' || rule.lower) continue
    if (rule.op !== '<' && rule.op !== '>') continue
    const action = rangeActionOf(rule)
    const key = `${rule.tag}\u0000${action}`
    const bound = byKey.get(key) ?? {
      tag: rule.tag,
      min: -Infinity,
      max: Infinity,
      action,
    }
    if (rule.op === '<') bound.min = rule.value
    else bound.max = rule.value
    byKey.set(key, bound)
  }
  return Array.from(byKey.values())
}

/**
 * The window one tag's preset-range rules keep, for display: the `<` rule
 * gives the lower bound, the `>` rule the upper. Read straight off the rules
 * (not `presetRangeBounds`), so a pair whose bounds were given different
 * actions still reads as ONE window. `null` = that side is open.
 */
export function presetRangeWindow(rules: ConditionalRule[]): {
  min: number | null
  max: number | null
} {
  let min: number | null = null
  let max: number | null = null
  for (const rule of rules) {
    if (rule.source !== 'preset-range' || rule.value === '' || rule.lower) {
      continue
    }
    if (rule.op === '<') min = rule.value
    else if (rule.op === '>') max = rule.value
  }
  return { min, max }
}

/**
 * True when any of these preset-range rules no longer carries the preset's
 * own value - i.e. the user edited a bound in the Outlier Removal panel.
 * Rules without a recorded `original` (saved before it existed) count as
 * unedited rather than guessed at.
 */
export function isPresetRangeEdited(rules: ConditionalRule[]): boolean {
  return rules.some(
    r =>
      r.source === 'preset-range' &&
      typeof r.presetRange?.original === 'number' &&
      r.value !== r.presetRange.original,
  )
}

/**
 * Validates an edited window before it is written to the rules. Both sides
 * are optional (an open-ended range has one); a present side must be a finite
 * number, and low must sit below high. Returns the reason, or null when valid.
 */
export function presetRangeEditError(
  min: number | null,
  max: number | null,
): string | null {
  if (min !== null && !Number.isFinite(min)) return 'Low must be a number'
  if (max !== null && !Number.isFinite(max)) return 'High must be a number'
  if (min !== null && max !== null && min >= max) {
    return 'Low must be below high'
  }
  return null
}
