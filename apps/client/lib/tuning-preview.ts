/**
 * MODEL-FLOW-025. What Find Best Parameters will try for one algorithm, worked
 * out on the client so Step 3 can SHOW it. Pure module (no React / IO).
 *
 * THE BACKEND BUILDS THE REAL LIST and this only reproduces the part that
 * depends on the user's own values: `tuningCandidatesFor`
 * (`apps/backend/src/lib/tuning-grid.ts`) takes the size-tiered grid, drops
 * every variant the base run already covers, keeps the first
 * `TUNE_VARIANTS_PER_JOB`, and — for lstm/gru — carries the base's
 * `sequence_length` onto each. The grid itself comes from the tuning-grid
 * endpoint (`useTuningGrid`), so this file holds no grid values. The backend
 * cannot be imported into the client bundle, so `previewVariants` is a second
 * implementation of that filter, and
 * `lib/__tests__/tuning-preview.test.ts` imports the backend and fails if the
 * two ever disagree, for every algorithm, size tier and a spread of bases.
 *
 * THE BASE IS WHAT THE JOB SENDS, NOT WHAT THE CARD HOLDS. `AlgorithmStack`'s
 * own `paramsFor` answers `{}` where the launch answers full defaults (an
 * algorithm with no entry, or a primary whose flat record is still virgin), and
 * at the `large` tier SVM's defaults ARE one of its variants, so the two would
 * give different lists. The wizard's run-config draft pre-fills defaults, which
 * hides that in practice; nothing at the component boundary guarantees it.
 * `baseHyperparamsFor` is the job's rule, moved here so the launch hook and the
 * preview call one function and cannot compute different bases.
 */
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import {
  HYPERPARAMS,
  defaultHyperparams,
  type HyperparamField,
} from '@/lib/training-config'
import { isSequenceAlgorithm } from '@/lib/metric-source'

export type TuningVariant = Record<string, HyperparamValue>

export interface VariantPreview {
  /** What a job would run, in order: the backend's `tuningCandidatesFor`
   *  output, including the `sequence_length` it carries for lstm/gru. */
  shown: TuningVariant[]
  /** Variants dropped because the base already covers them — the "never
   *  re-run what already ran" rule. Cap trimming is not counted here. */
  skipped: number
}

export interface VariantColumn {
  key: string
  label: string
}

/**
 * The hyperparameters a run of `algorithm` is launched with, which is also the
 * base a Find Best Parameters search excludes variants against. The PRIMARY
 * algorithm reads the flat record, every other algorithm its own entry, and
 * either is laid OVER the algorithm's full defaults.
 *
 * MODEL-FLOW-025-T05. The overlay is the fix: a partial record (one field
 * edited, the rest left blank) used to be sent as-is, and the backend's
 * whole-record `alreadyCovered` never matched it against a full variant — so a
 * search re-ran a setting whose effective values equal the base, a wasted fit.
 * The value filled in is the catalogue default the form already displays for
 * that field, and the same one a sweep has always sent for an untouched
 * algorithm (MODEL-FLOW-022-T04). Keys the catalogue does not know are kept.
 */
export function baseHyperparamsFor(
  algorithm: Algorithm,
  algorithms: Algorithm[],
  flat: Record<string, HyperparamValue>,
  perAlgorithm: Partial<Record<Algorithm, Record<string, HyperparamValue>>>,
): Record<string, HyperparamValue> {
  const own =
    algorithm === algorithms[0] ? flat : (perAlgorithm[algorithm] ?? {})
  return { ...defaultHyperparams(algorithm), ...own }
}

function sameRecord(a: TuningVariant, b: Record<string, HyperparamValue>) {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key],
    )
  )
}

/**
 * The backend's `alreadyCovered`. TABULAR algorithms compare the whole record,
 * so a base carrying a key no variant names covers nothing (pinned there as
 * pre-existing behaviour, not endorsed). lstm/gru compare on the variant's own
 * keys, because their base also holds `sequence_length`, which no variant
 * names.
 */
function covers(
  algorithm: Algorithm,
  variant: TuningVariant,
  base: Record<string, HyperparamValue>,
): boolean {
  if (!isSequenceAlgorithm(algorithm)) return sameRecord(variant, base)
  const keys = Object.keys(variant)
  return keys.length > 0 && keys.every(key => base[key] === variant[key])
}

/**
 * `variants` is the tuning-grid endpoint's list for this algorithm and dataset
 * size; `cap` its `maxVariantsPerJob`, not a constant kept here.
 */
export function previewVariants(
  algorithm: Algorithm,
  variants: TuningVariant[],
  base: Record<string, HyperparamValue>,
  cap: number,
): VariantPreview {
  const carried: TuningVariant =
    isSequenceAlgorithm(algorithm) && typeof base.sequence_length === 'number'
      ? { sequence_length: base.sequence_length }
      : {}
  const remaining = variants.filter(v => !covers(algorithm, v, base))
  return {
    shown: remaining.slice(0, cap).map(v => ({ ...v, ...carried })),
    skipped: variants.length - remaining.length,
  }
}

/** Carried across from the base, never varied — so it is not a column. */
const CARRIED_KEY = 'sequence_length'

/**
 * The columns of the variant table: only the keys the variants actually vary,
 * in the form's own field order and with the form's labels, so a column reads
 * the same as the field above it. A key the form does not know is appended
 * under its raw name rather than dropped, since dropping it would hide a knob
 * the search turns.
 */
export function variantColumns(
  algorithm: Algorithm,
  variants: TuningVariant[],
): VariantColumn[] {
  const present = new Set(variants.flatMap(v => Object.keys(v)))
  present.delete(CARRIED_KEY)
  const known = (HYPERPARAMS[algorithm] ?? [])
    .filter(f => present.has(f.key))
    .map(f => ({ key: f.key, label: f.label }))
  const knownKeys = new Set(known.map(c => c.key))
  const unknown = [...present]
    .filter(key => !knownKeys.has(key))
    .map(key => ({ key, label: key }))
  return [...known, ...unknown]
}

/**
 * One table cell. `null` is "unlimited" only where the field has that toggle;
 * a select value reads as the label the form shows for it.
 */
export function formatVariantValue(
  field: HyperparamField | undefined,
  value: HyperparamValue,
): string {
  if (value === null)
    return field?.kind === 'nullable-number' ? 'unlimited' : '—'
  if (field?.kind === 'select') {
    return field.options.find(o => o.value === value)?.label ?? String(value)
  }
  if (field?.kind === 'checkbox' || typeof value === 'boolean') {
    return value ? 'on' : 'off'
  }
  return String(value)
}
