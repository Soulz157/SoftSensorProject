/**
 * MODEL-FLOW-024. The suggested hyperparameter bands the Step 3 form shows,
 * chosen by dataset size. Pure module (no React / IO), the size-aware half of
 * `lib/training-config.ts`.
 *
 * ONE FIGURE: ROWS. Capacity bands (`n_estimators`, `num_leaves`,
 * `max_depth`, `alpha`, `C`, hidden size) tier on the dataset's ROW COUNT —
 * the user's decision of 2026-09-21, given as durations of hourly data:
 * tiny < 6 months, small 6-12 months, medium 1-3 years, large > 3 years
 * (4,380 / 8,760 / 26,280 rows). It reverses this module's first design,
 * which tiered on DISTINCT LABELLED VALUES because a lab target
 * forward-filled onto a fine grid makes 8,350 rows hold 32 independent
 * observations (MODEL-FLOW-020 finding 1); a row tier lands the datasets
 * measured so far (4,470-15,441 rows) in `small`/`medium` instead of
 * `tiny`/`small`. The threshold is a row count, not a duration: the
 * pipeline's interval is per-dataset, so "months" is true for hourly data
 * only. LSTM/GRU `batch_size` keys on rows as well: it sets steps per epoch,
 * a compute quantity, and every row is a training window whether or not its
 * target repeats its neighbour's.
 *
 * MEDIUM IS `HYPERPARAMS`' OWN `suggestedRange`, so nothing is duplicated for
 * it and an unknown size (split not applied yet) shows what the form always
 * showed. `TIER_BANDS` holds only the overrides for the other three tiers.
 *
 * THESE BANDS ARE DECLARED PRIORS, NOT MEASURED OPTIMA. MODEL-FLOW-020-T03
 * measured capacity against real holdouts at 32 and 59 distinct labelled
 * values and found no size-dependent ordering; the scaling was added at the
 * user's request regardless, and the form says so. Nothing here constrains an
 * input — same advisory contract `SuggestedRange` has always had.
 *
 * MIRRORED IN `apps/backend/src/lib/tuning-grid.ts`, which holds the variants
 * Find Best Parameters actually tries. Every value it can try for an
 * algorithm and key at a tier must sit inside the band declared here for the
 * same tier; `lib/__tests__/training-config-grid-agreement.test.ts` imports
 * that module and fails if one does not, and if the two sides disagree about
 * which tier a figure belongs to.
 */
import type { Algorithm } from '@/store/model-pipeline'
import {
  HYPERPARAMS,
  type HyperparamField,
  type SuggestedRange,
} from '@/lib/training-config'

export type SizeTier = 'tiny' | 'small' | 'medium' | 'large'

/** Lower bound of each tier above `tiny`, in rows (hourly: 6 months, 1 year, 3 years). */
export const SIZE_TIER_LOWER_BOUNDS = {
  small: 4380,
  medium: 8760,
  large: 26280,
} as const

/** `null`/`undefined`/non-finite resolve to `medium`: no figure means today's bands. */
export function sizeTierFor(rows: number | null | undefined): SizeTier {
  if (rows == null || !Number.isFinite(rows)) return 'medium'
  if (rows < SIZE_TIER_LOWER_BOUNDS.small) return 'tiny'
  if (rows < SIZE_TIER_LOWER_BOUNDS.medium) return 'small'
  if (rows < SIZE_TIER_LOWER_BOUNDS.large) return 'medium'
  return 'large'
}

/**
 * The dataset's size figures. `rows` drives the tier and the LSTM/GRU batch
 * cap: the `/split-stats` response's `source_rows` once Step 3 has fetched it,
 * else the saved dataset's own row count (see `datasetSizeFrom`).
 * `distinctLabelled`, its `distinct_labelled_values`, is carried for display
 * and the record only — it no longer picks a tier. All optional.
 */
export interface DatasetSize {
  distinctLabelled?: number | null
  rows?: number | null
  /**
   * The feature columns the model trains on. Read only by `pls`, whose
   * `n_components` cannot exceed it — a size-independent cap, so it applies at
   * every tier.
   */
  features?: number | null
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n))

/**
 * The `batch_size` band for LSTM/GRU: at most an eighth of the rows (so an
 * epoch is at least ~8 gradient steps), never above 128, never below 8, with a
 * floor of a quarter of that cap. Unknown rows, and any dataset of 1,024+
 * rows, give the 16-128 band the form always showed — on the real datasets
 * seen so far (4,470-15,441 source rows) this cap does not bind; it matters
 * only for small data. Uses SOURCE rows, the figure the job row records,
 * which overstates training windows by at most the split ratio.
 */
export function batchSizeBand(rows: number | null | undefined): {
  min: number
  max: number
} {
  if (rows == null || !Number.isFinite(rows)) return { min: 16, max: 128 }
  const max = clamp(Math.floor(rows / 8), 8, 128)
  const min = clamp(Math.floor(max / 4), 4, 16)
  return { min, max }
}

type Band = readonly [min: number, max: number]
type TierBands = Partial<Record<Exclude<SizeTier, 'medium'>, Band>>

/**
 * Band overrides per algorithm, field key and tier. A key or tier absent here
 * reads `HYPERPARAMS`' own band (the medium one). Only algorithms with a
 * capacity dial appear: `ols`, `grp` and `pls` have no size prior anywhere in
 * this codebase, `svm`'s epsilon and `mlp`'s max_iter are not capacity, and
 * `lstm`/`gru` scale through `batch_size` alone.
 */
export const TIER_BANDS: Partial<Record<Algorithm, Record<string, TierBands>>> =
  {
    ridge: {
      alpha: { tiny: [1, 300], small: [0.1, 100], large: [0.001, 30] },
    },
    hist_gradient_boosting: {
      learning_rate: {
        tiny: [0.03, 0.3],
        small: [0.03, 0.3],
        large: [0.01, 0.2],
      },
      n_estimators: { tiny: [30, 150], small: [50, 300], large: [200, 800] },
      num_leaves: { tiny: [3, 15], small: [4, 31], large: [15, 127] },
    },
    svm: {
      C: { tiny: [0.01, 10], small: [0.03, 30], large: [0.3, 300] },
    },
    mlp: {
      hidden_layer_sizes: {
        tiny: [8, 64],
        small: [16, 128],
        large: [100, 600],
      },
      alpha: {
        tiny: [0.001, 0.1],
        small: [0.0001, 0.03],
        large: [0.000001, 0.001],
      },
    },
    random_forest: {
      n_estimators: { tiny: [50, 200], small: [100, 300], large: [200, 800] },
      max_depth: { tiny: [3, 8], small: [4, 12], large: [8, 30] },
      // MODEL-FLOW-026. The two `min_samples_*` floors run the opposite way to
      // every other band here: they are a guard against leaves that memorise a
      // few rows, so a bigger dataset needs a SMALLER floor, not a larger one.
      max_leaf_nodes: { tiny: [8, 64], small: [16, 128], large: [64, 1024] },
      min_samples_leaf: { tiny: [2, 40], small: [1, 20], large: [1, 10] },
      min_samples_split: { tiny: [4, 60], small: [2, 40], large: [2, 20] },
    },
    lightgbm: {
      learning_rate: {
        tiny: [0.03, 0.3],
        small: [0.03, 0.3],
        large: [0.01, 0.2],
      },
      num_leaves: { tiny: [3, 15], small: [5, 31], large: [31, 255] },
    },
    xgboost: {
      n_estimators: { tiny: [30, 150], small: [50, 300], large: [200, 1000] },
      learning_rate: { tiny: [0.03, 0.3], small: [0.03, 0.3] },
      max_depth: { tiny: [2, 4], small: [2, 6], large: [4, 12] },
    },
  }

const SEQUENCE: readonly Algorithm[] = ['lstm', 'gru']

/**
 * The band to show under one field for a dataset of this size, or `undefined`
 * for a field with no band (a select or checkbox). Keeps the field's own
 * `note` — what the parameter DOES does not change with size, only where a
 * reasonable value sits.
 */
export function suggestedRangeFor(
  algorithm: Algorithm,
  field: HyperparamField,
  size: DatasetSize = {},
): SuggestedRange | undefined {
  if (field.kind !== 'number' && field.kind !== 'nullable-number') {
    return undefined
  }
  const medium = field.suggestedRange
  if (!medium) return undefined

  if (SEQUENCE.includes(algorithm) && field.key === 'batch_size') {
    const { min, max } = batchSizeBand(size.rows)
    // 128 is the form's own ceiling, and its floor is 16 whenever the cap is
    // that high — so an unbound cap IS the medium band, returned by reference.
    if (max >= 128) return medium
    return {
      min,
      max,
      note: 'windows per gradient step; capped at an eighth of the rows',
    }
  }

  // MODEL-FLOW-024. PLS cannot fit more components than the data has
  // features (sklearn raises, and `build_model` deliberately does not clamp),
  // so the band's ceiling follows the feature count whatever the tier. Below
  // the general ceiling only; at or above it the general band is returned
  // untouched, by reference, like every other unsized case.
  if (algorithm === 'pls' && field.key === 'n_components') {
    const features = size.features
    if (features == null || !Number.isFinite(features) || features < 1) {
      return medium
    }
    const max = Math.max(1, Math.min(medium.max, Math.floor(features)))
    return max >= medium.max ? medium : { ...medium, max }
  }

  const tier = sizeTierFor(size.rows)
  if (tier === 'medium') return medium
  const band = TIER_BANDS[algorithm]?.[field.key]?.[tier]
  return band ? { ...medium, min: band[0], max: band[1] } : medium
}

/**
 * True when this size actually changes at least one band for the algorithm —
 * what decides whether the form says "sized to N values" or the honest
 * "not sized" line. Derived from `suggestedRangeFor` itself (a band it left
 * untouched is returned BY REFERENCE), so the two cannot drift: the moment a
 * new way of sizing a band is added there, this reports it.
 */
export function isSizedFor(
  algorithm: Algorithm,
  size: DatasetSize = {},
): boolean {
  return (HYPERPARAMS[algorithm] ?? []).some(
    f =>
      (f.kind === 'number' || f.kind === 'nullable-number') &&
      suggestedRangeFor(algorithm, f, size) !== f.suggestedRange,
  )
}

export const SIZE_TIER_LABELS: Record<SizeTier, string> = {
  tiny: 'very small',
  small: 'small',
  medium: 'mid-size',
  large: 'large',
}

const PRIOR_CAVEAT =
  'These are starting points, not measured optima — on the data measured so far, no value within them changed holdout error measurably.'

const grouped = (n: number): string => n.toLocaleString('en-US')

/**
 * The one line the form says about how its ranges were chosen, rendered once
 * above the fields. It has to be one of four different truths and never the
 * wrong one: MODEL-FLOW-020-T05's original line ("not your dataset") is false
 * as soon as a range is sized, and a "sized to your data" line would be false
 * for `ols`, `grp` and `pls`, which no size ever changes.
 *
 * Names the row count and the row span of the tier it fell in, with the
 * hourly-data reading of that span: the tier keys on rows, and the months are
 * true only where a row is an hour, so the row span is the figure to trust.
 */
export function describeSizing(
  algorithm: Algorithm,
  size: DatasetSize = {},
): string {
  if (SEQUENCE.includes(algorithm)) {
    return isSizedFor(algorithm, size)
      ? `Batch size is capped at an eighth of your ${grouped(size.rows ?? 0)} rows, so an epoch is at least ~8 gradient steps. The other ranges describe the estimator, not your dataset. ${PRIOR_CAVEAT}`
      : `Suggested ranges describe the estimator, not your dataset. ${PRIOR_CAVEAT}`
  }
  if (algorithm === 'pls' && isSizedFor(algorithm, size)) {
    return `N-components is capped at your ${grouped(size.features ?? 0)} features — PLS cannot fit more components than features. The other range describes the estimator, not your dataset. ${PRIOR_CAVEAT}`
  }
  // Before the "apply the split" line: an algorithm no tier sizes has nothing
  // for a split to size, so telling its reader to apply one would be false.
  if (TIER_BANDS[algorithm] === undefined) {
    return `This algorithm has no size-dependent range, so these describe the estimator in general. ${PRIOR_CAVEAT}`
  }
  if (size.rows == null) {
    return `Suggested ranges describe each estimator, not your dataset — apply the train/test split to size them to your data. ${PRIOR_CAVEAT}`
  }
  const n = grouped(size.rows)
  const tier = sizeTierFor(size.rows)
  if (tier === 'medium') {
    return `Your ${n} rows fall in the mid-size tier (${describeTier(tier)}), so these are the estimator's general ranges. ${PRIOR_CAVEAT}`
  }
  return `Sized to your ${n} rows — a ${SIZE_TIER_LABELS[tier]} dataset (${describeTier(tier)}). ${PRIOR_CAVEAT}`
}

/**
 * The hourly-data reading of each tier's row span. Static text, guarded by a
 * test that pins `SIZE_TIER_LOWER_BOUNDS` to 6 months / 1 year / 3 years of
 * hourly rows, so changing a bound without rewording this fails loudly.
 */
const TIER_HOURLY_READING: Record<SizeTier, string> = {
  tiny: 'under 6 months',
  small: '6-12 months',
  medium: '1-3 years',
  large: 'over 3 years',
}

/** "4,380-8,759 rows, 6-12 months of hourly data" — the span comes from the bounds, so it cannot drift from them. */
function describeTier(tier: SizeTier): string {
  const { small, medium, large } = SIZE_TIER_LOWER_BOUNDS
  const span: Record<SizeTier, string> = {
    tiny: `under ${grouped(small)} rows`,
    small: `${grouped(small)}-${grouped(medium - 1)} rows`,
    medium: `${grouped(medium)}-${grouped(large - 1)} rows`,
    large: `${grouped(large)}+ rows`,
  }
  return `${span[tier]}, ${TIER_HOURLY_READING[tier]} of hourly data`
}

/**
 * The size the form should use, from what Step 3 actually has.
 * `distinctLabelled` and `rows` come from the `/split-stats` response when it
 * resolved. That fetch waits for Apply, and is NEVER made while an lstm/gru is
 * selected (its ratio split means nothing for windows), so `datasetRowCount`,
 * the saved dataset's own count, stands in for `rows`: the tier and the
 * LSTM/GRU batch cap both key on rows, so the size is known from the moment a
 * dataset is picked. It does not stand in for `distinctLabelled` — distinct
 * values need a full artifact read the client does not have — and nothing
 * reads `distinctLabelled` for a tier any more.
 *
 * `useModelTraining` sends the job its rows through this same function, so
 * the ranges the form shows and the variants a search tries come from one
 * figure and cannot disagree before Apply.
 */
export function datasetSizeFrom(
  stats:
    | {
        distinct_labelled_values?: number | null
        source_rows?: number | null
      }
    | null
    | undefined,
  datasetRowCount?: number | null,
  featureCount?: number | null,
): DatasetSize {
  const fallbackRows =
    datasetRowCount != null && datasetRowCount > 0 ? datasetRowCount : null
  return {
    distinctLabelled: stats?.distinct_labelled_values ?? null,
    rows: stats?.source_rows ?? fallbackRows,
    // The wizard's own count (dataset tags minus targets — the same figure the
    // runtime estimate uses). Read only by pls; the backend caps the grid off
    // the artifact row's `featureCount`, and where the two differ (engineered
    // features) the form's band is the more conservative of the pair.
    features: featureCount != null && featureCount >= 1 ? featureCount : null,
  }
}
