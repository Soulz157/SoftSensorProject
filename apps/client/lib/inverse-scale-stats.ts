/**
 * DS-LAKE-026. Inverse-scales a train-side histogram/boxplot RESULT — not a
 * bare value — to engineering units, for the compare modal's Histogram and
 * Box Plot tabs. Builds on `inverseScale` (`lib/inverse-scale.ts`) rather
 * than reimplementing per-method arithmetic.
 *
 * POSITIONS VS. SPREADS. `inverseScale` applies the full affine map
 * `scaled * slope + offset` — correct for a POSITION (a mean, a quantile, a
 * KDE x-coordinate: a point that sits somewhere on the axis). A SPREAD (a
 * std-dev, a range, an IQR) is a DIFFERENCE of two positions, and the offset
 * cancels out of a difference — `inverseScale`ing a spread directly adds the
 * offset back in and produces a plausible-looking wrong number. A spread
 * must be scaled by the slope alone.
 *
 * All three scaler methods `inverse-scale.ts` supports are affine with a
 * POSITIVE slope (minmax: `max - min`; standard: `std`; robust: `iqr`), so
 * ordering never flips and every field below can be converted independently
 * without re-sorting.
 *
 * `kde[].y` needs no conversion at all: it is already a COUNT, not a density
 * (`density * n * binWidth` — see `DraftTagHistogram.kde`'s own doc
 * comment). Under `x' = a·x + b` the bin width scales by `a` and the density
 * by `1/a`, so their product is invariant — only the x-coordinates move.
 */
import type {
  DraftBoxplotResult,
  DraftHistogramResult,
  DraftTagBoxplot,
  DraftTagHistogram,
} from '@/services/dataset-draft'
import type { ArtifactScalingParams } from '@/services/dataset-version'
import { inverseScale, isInvertible } from './inverse-scale'

/** A point on the axis — a mean, a quantile, a KDE x-coordinate. Full affine
 * inversion, offset included. Delegates to `inverseScale` unchanged; the
 * separate name exists so a caller cannot reach for the wrong one by
 * accident (see `inverseScaleSpread` below). */
export function inverseScalePosition(
  value: number | null,
  params: ArtifactScalingParams | undefined,
): number | null {
  return inverseScale(value, params)
}

/**
 * A difference of two positions — a std-dev, a range, an IQR. Scaled by the
 * transform's SLOPE only, never its offset.
 *
 * Computed as `inverseScale(1) - inverseScale(0)` rather than duplicating
 * `inverse-scale.ts`'s per-method branching: for an affine map
 * `f(x) = slope*x + offset`, `f(1) - f(0) = slope`, exactly, for every
 * method that module supports. It also inherits that module's own
 * invertibility rule for free — the robust method's zero-IQR case returns
 * `null` for both `f(0)` and `f(1)`, so the slope comes back `null` too,
 * matching `isInvertible`'s own criterion.
 */
export function inverseScaleSpread(
  value: number | null,
  params: ArtifactScalingParams | undefined,
): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const zero = inverseScale(0, params)
  const one = inverseScale(1, params)
  if (zero === null || one === null) return null
  return value * (one - zero)
}

/**
 * One tag's histogram response inverted to engineering units, or `null`
 * when `params` cannot be inverted — the caller drops the tag into
 * `insufficient_tags` rather than plot a scaled number.
 */
function inverseScaleHistogramTag(
  tag: DraftTagHistogram,
  params: ArtifactScalingParams | undefined,
): DraftTagHistogram | null {
  if (!isInvertible(params)) return null
  const pos = (v: number) => inverseScalePosition(v, params)!
  const spread = (v: number) => inverseScaleSpread(v, params)!
  return {
    ...tag,
    mean: pos(tag.mean),
    median: pos(tag.median),
    mode: pos(tag.mode),
    min: pos(tag.min),
    max: pos(tag.max),
    std: spread(tag.std),
    range: spread(tag.range),
    kde: tag.kde.map(p => ({ x: pos(p.x), y: p.y })),
  }
}

/**
 * A full histogram result, per tag, to engineering units.
 *
 * `domain_min`/`domain_max` are NOT inverted from the request's own —
 * that domain is one shared value across every OVERLAID tag in SCALED
 * space, computed before this function ever sees the response, and each
 * tag here may carry a different scaler fit. Instead the domain is
 * RECOMPUTED as the min/max across the tags that actually inverted — the
 * same "shared axis over the actual data extent" rule the modal's own
 * `sharedYDomain` (`dataset-compare-modal.tsx`) already applies to the Line
 * tab's multi-tag Y axis.
 *
 * A tag whose params cannot be inverted moves from `tags` to
 * `insufficient_tags` — plotting it scaled beside inverted tags on the same
 * axis is exactly the two-unit-space defect this whole path exists to
 * avoid. In practice this should never fire: the modal's `plottableTags`
 * filter already excludes non-invertible tags from `selected` before a
 * request is ever sent.
 */
export function inverseScaleHistogram(
  result: DraftHistogramResult,
  scalingParams: Record<string, ArtifactScalingParams> | null,
): DraftHistogramResult {
  const tags: DraftTagHistogram[] = []
  const insufficientTags = [...result.insufficient_tags]

  for (const tag of result.tags) {
    const inverted = inverseScaleHistogramTag(tag, scalingParams?.[tag.tag])
    if (inverted) tags.push(inverted)
    else insufficientTags.push(tag.tag)
  }

  let domainMin: number | null = null
  let domainMax: number | null = null
  for (const tag of tags) {
    if (domainMin === null || tag.min < domainMin) domainMin = tag.min
    if (domainMax === null || tag.max > domainMax) domainMax = tag.max
  }

  return {
    source_key: result.source_key,
    domain_min: domainMin,
    domain_max: domainMax,
    tags,
    insufficient_tags: insufficientTags,
  }
}

/** One tag's box plot response inverted to engineering units, or `null`
 * when `params` cannot be inverted. Every field here is a position — a box
 * plot has no spread field of its own (an IQR the caller wants must be
 * derived as `q3 - q1` AFTER this inversion, never inverted as a spread
 * itself, since `q1`/`q3` are already positions here). */
function inverseScaleBoxplotTag(
  tag: DraftTagBoxplot,
  params: ArtifactScalingParams | undefined,
): DraftTagBoxplot | null {
  if (!isInvertible(params)) return null
  const pos = (v: number) => inverseScalePosition(v, params)!
  return {
    ...tag,
    min: pos(tag.min),
    q1: pos(tag.q1),
    median: pos(tag.median),
    mean: pos(tag.mean),
    q3: pos(tag.q3),
    max: pos(tag.max),
    whisker_low: pos(tag.whisker_low),
    whisker_high: pos(tag.whisker_high),
    outliers: tag.outliers.map(pos),
  }
}

/** A full box plot result, per tag, to engineering units. No shared domain
 * field exists on `DraftBoxplotResult` to reconcile — `TagBoxplotChart`
 * derives its own Y ticks per render from the rows it is handed. */
export function inverseScaleBoxplot(
  result: DraftBoxplotResult,
  scalingParams: Record<string, ArtifactScalingParams> | null,
): DraftBoxplotResult {
  const tags: DraftTagBoxplot[] = []
  const insufficientTags = [...result.insufficient_tags]

  for (const tag of result.tags) {
    const inverted = inverseScaleBoxplotTag(tag, scalingParams?.[tag.tag])
    if (inverted) tags.push(inverted)
    else insufficientTags.push(tag.tag)
  }

  return {
    source_key: result.source_key,
    tags,
    insufficient_tags: insufficientTags,
  }
}
