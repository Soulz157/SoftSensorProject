/**
 * Custom Finetune's starting values. Pure — no React, no IO.
 *
 * The form reuses the model wizard's own hyperparameter table and train/test
 * split control, so it speaks their shapes: a full `Record<string,
 * HyperparamValue>` for the table and an integer percent for the split.
 */
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { defaultHyperparams } from '@/lib/training-config'

/** The wizard's own default split, used when the current version recorded
 *  no usable ratio. */
export const DEFAULT_SPLIT_PERCENT = 80

function isHyperparamValue(value: unknown): value is HyperparamValue {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
}

/**
 * The current version's own hyperparameters laid over the algorithm's full
 * defaults — so the table opens on what is live, and every knob is present
 * (a key the version never recorded still gets sent, as its default, rather
 * than silently left to the trainer). Non-scalar values cannot be shown or
 * edited in the table and are dropped.
 */
export function finetuneStartingHyperparams(
  algorithm: Algorithm,
  incumbent: Record<string, unknown> | null,
): Record<string, HyperparamValue> {
  const own: Record<string, HyperparamValue> = {}
  for (const [key, value] of Object.entries(incumbent ?? {})) {
    if (isHyperparamValue(value)) own[key] = value
  }
  return { ...defaultHyperparams(algorithm), ...own }
}

/** A curated variant as a full record: the variant's knobs over the
 *  defaults, the same overlay the wizard's search uses. */
export function variantAsHyperparams(
  algorithm: Algorithm,
  variant: Record<string, HyperparamValue>,
): Record<string, HyperparamValue> {
  return { ...defaultHyperparams(algorithm), ...variant }
}

/**
 * The current version's train ratio as the split control's percent, snapped
 * to its 5% step and 50–95 range (the server's own bounds are 0.5–0.95).
 */
export function splitPercentFrom(ratio: number | null): number {
  if (ratio === null || !(ratio > 0 && ratio < 1)) return DEFAULT_SPLIT_PERCENT
  const snapped = Math.round((ratio * 100) / 5) * 5
  return Math.min(95, Math.max(50, snapped))
}
