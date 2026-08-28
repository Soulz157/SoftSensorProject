/**
 * DS-LAKE-025-T06. Recover engineering units from a model-ready artifact's
 * scaled values, using the params its scaler actually FIT
 * (`feature_spec.json`'s `scalingParams`).
 *
 * WHY THIS EXISTS. T06 established that a saved dataset's FINAL is the
 * post-`to_model_ready` frame — every tag min-max scaled to [0,1] by default,
 * with no UI affordance to decline. T06 read 6 also established that
 * `images/trainer/train.py` consumes those scaled bytes directly and re-fits
 * nothing, so FINAL being scaled is LOAD-BEARING: the fix is to invert on
 * READ for display, never to unscale the artifact.
 *
 * PRECISION. `_scale_column` (apps/python/services/feature_service.py) applies
 * `_round_to(x, 3)` to every scaled value before writing. Recovered precision
 * is therefore `0.001 * span` — roughly ±45 engineering units on a tag
 * spanning 45,000. Adequate for display; NOT byte-exact, and any surface using
 * this must say so rather than imply the original numbers came back.
 */
import type { ScalerMethod } from '@/lib/preprocessing'
import type { ArtifactScalingParams } from '@/services/dataset-version'

/**
 * Which transform a params record describes, read from WHICH KEYS it carries.
 *
 * Deliberately not read from `feature_spec.json`'s `scaling` list, which is
 * built from `sorted(scalers.items())` — the user's EXPLICIT config only
 * (feature_spec_service.py:223-224). T06 confirmed live that a dataset scaled
 * entirely by `DEFAULT_SCALER` carries `"scaling": []` alongside a fully
 * populated `scalingParams` of 22 min/max entries. Trusting `scaling` would
 * therefore conclude "not scaled" about a frame that IS scaled — the exact
 * inversion of the truth. The params themselves cannot lie about their shape.
 */
export function inferScalerMethod(
  params: ArtifactScalingParams,
): ScalerMethod | null {
  if ('min' in params && 'max' in params) return 'minmax'
  if ('mean' in params && 'std' in params) return 'standard'
  if ('median' in params && 'iqr' in params) return 'robust'
  return null
}

/**
 * `null` means "cannot be stated in engineering units" and must render as an
 * em-dash or be excluded — never as the scaled number, which would read as a
 * real measurement orders of magnitude off.
 *
 * Returns null for: a null/non-finite input, unrecorded params (a sidecar
 * predating DS-LAKE-018-T02), an unrecognised params shape, and the one
 * genuinely destroyed case below.
 */
export function inverseScale(
  scaled: number | null,
  params: ArtifactScalingParams | undefined,
): number | null {
  if (scaled === null || !Number.isFinite(scaled)) return null
  if (!params) return null

  const method = inferScalerMethod(params)
  if (method === null) return null

  if (method === 'minmax') {
    const min = params.min
    const max = params.max
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    // span 0 means every finite value equalled `min`, and `_scale_column`
    // wrote 0.0 for all of them — so `min` IS the original value. Invertible,
    // unlike the `robust` case below.
    return max === min ? min! : scaled * (max! - min!) + min!
  }

  if (method === 'standard') {
    const mean = params.mean
    const std = params.std
    if (!Number.isFinite(mean) || !Number.isFinite(std)) return null
    // std 0 means every value equalled the mean — same reasoning as above.
    return std === 0 ? mean! : scaled * std! + mean!
  }

  // robust
  const median = params.median
  const iqr = params.iqr
  if (!Number.isFinite(median) || !Number.isFinite(iqr)) return null
  // iqr 0 is the ONE genuinely non-invertible case. Unlike a zero span or a
  // zero std, an interquartile range of 0 does NOT imply the values were
  // constant — a column can have a tight middle and spread tails. Python
  // wrote 0.0 for every row regardless, so the original values are gone.
  // Returning `median` here would invent a measurement for every row.
  if (iqr === 0) return null
  return scaled * iqr! + median!
}

/**
 * Whether a tag can be shown in engineering units at all. A surface should
 * exclude the ones that cannot — with a stated reason — rather than plot them
 * beside inverted tags on a shared axis, which is exactly what makes two
 * differently-scaled series look like a process change.
 */
export function isInvertible(
  params: ArtifactScalingParams | undefined,
): boolean {
  return inverseScale(1, params) !== null
}
