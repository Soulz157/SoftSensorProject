import type { ParsedRange } from '@/lib/feature-preset'
import type { Dataset } from '@/lib/preprocessing'

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
 * `tph` | `t/h`, `c` | `°c` | `degc`). Units with no synonym-table entry
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

export interface RangeCutoffGuardInput {
  /** The frame the enabled cutoffs would apply against. */
  dataset: Dataset
  /** Currently enabled preset-range bounds, one entry per tag. */
  activeBounds: { tag: string; min: number; max: number }[]
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

  let remainingRows = 0
  let remainingLabelled = 0
  for (const row of dataset.rows) {
    const violated = activeBounds.some(({ tag, min, max }) => {
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
      'Every row would be marked Bad by the enabled range cutoffs — at ' +
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
