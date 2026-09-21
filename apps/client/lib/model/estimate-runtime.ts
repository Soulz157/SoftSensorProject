// Relative training cost per algorithm, normalised to LightGBM = 1.0
const ALGO_COST: Record<string, number> = {
  ols: 0.15,
  ridge: 0.15,
  lasso: 0.2,
  elasticnet: 0.2,
  dt: 0.4,
  knn: 0.5,
  lightgbm: 1.0,
  xgboost: 1.3,
  gbr: 1.6,
  et: 1.5,
  rf: 1.8,
  catboost: 2.0,
  mlp: 2.5,
  svr: 3.0,
}

export const ALGO_LABEL: Record<string, string> = {
  ols: 'OLS',
  ridge: 'Ridge',
  lasso: 'Lasso',
  elasticnet: 'ElasticNet',
  dt: 'Decision Tree',
  knn: 'KNN',
  lightgbm: 'LightGBM',
  xgboost: 'XGBoost',
  gbr: 'Gradient Boosting',
  et: 'Extra Trees',
  rf: 'Random Forest',
  catboost: 'CatBoost',
  mlp: 'Neural Net',
  svr: 'SVR',
}

/**
 * MODEL-FLOW-024. Fits a Find Best Parameters phase adds on top of the run it
 * tunes. Mirrors the backend's `TUNE_VARIANTS_PER_JOB` (tuning-grid.ts): a
 * search is the base fit plus at most this many variants of ONE algorithm, no
 * cross-validation. It is an ESTIMATE's input, not a contract — the real cap
 * is the backend's, so if that moves this drifts by a constant factor inside
 * a range the panel already shows as 0.6x-2x.
 */
const TUNE_VARIANTS = 4

export const SUPERLINEAR = new Set(['svr', 'knn', 'mlp'])

export interface AlgoShare {
  id: string
  label: string
  seconds: number
  pct: number
}

/** Relative cost of each SELECTED algorithm; an id the table does not know
 *  costs 1, the same fallback the estimate has always used. */
function selectedCosts(algorithms: string[]): number[] {
  return algorithms.map(a => ALGO_COST[a] ?? 1)
}

/**
 * Each selected algorithm's share of the headline estimate. Shares are
 * proportional to cost and scaled to the SAME total `estimateRuntimeSeconds`
 * returns, so they sum to the headline by construction — the old version
 * re-ran the estimate per algorithm, and its per-call 2s floor could push the
 * shares past the total.
 *
 * MODEL-FLOW-024. Only the SELECTED algorithms appear. A sweep used to list
 * every entry of `ALGO_COST` (14, several of which — lasso, catboost — this
 * catalogue does not have), on the belief a sweep tries them all. It tries
 * the ones the user ticked, one candidate each.
 */
export function breakdownRuntime(input: RuntimeInput): AlgoShare[] {
  const ids = input.algorithms
  if (ids.length === 0) return []

  const weights = selectedCosts(ids)
  const sum = weights.reduce((s, w) => s + w, 0) || 1
  const total = estimateRuntimeSeconds(input)
  return ids
    .map((id, i) => ({
      id,
      label: ALGO_LABEL[id] ?? id,
      seconds: (total * weights[i]!) / sum,
      pct: (weights[i]! / sum) * 100,
    }))
    .sort((a, b) => b.seconds - a.seconds)
}

const SEC_PER_CELL = 1 / 2_000_000

export interface RuntimeInput {
  rows: number
  features: number
  algorithms: string[]
  targets: number
  findBestModel: boolean
  findBestParams: boolean
  nEstimators?: number
  /**
   * MODEL-FLOW-025-T06. How many variants Find Best Parameters would actually
   * run for each algorithm — the Step 3 preview's count, after excluding what
   * the base already covers. An algorithm missing here falls back to
   * `TUNE_VARIANTS`, the cap, so an unknown count still over- rather than
   * under-estimates.
   */
  tuningVariants?: Partial<Record<string, number>>
}

/**
 * MODEL-FLOW-024. CORRECTED — this priced Find Best Parameters as "random
 * search ≈ 10 candidates × 5-fold CV" and a sweep as every algorithm in
 * `ALGO_COST`. Neither exists: the backend runs the base fit plus at most
 * `TUNE_VARIANTS_PER_JOB` variants with no cross-validation, and a sweep runs
 * one candidate per SELECTED algorithm. So the cost is additive, not a
 * multiplier:
 *
 *   base   = sum of the selected algorithms' costs (each fits once)
 *   tuning = the AVERAGE over selected algorithms of (its variant count x its
 *            cost) — one algorithm's variants, and which one wins a sweep is
 *            unknown until it ends. The count is the preview's when known
 *            (MODEL-FLOW-025-T06), else TUNE_VARIANTS
 *
 * A single algorithm with Find Best Parameters is therefore 5x one fit, not
 * 10x. `findBestModel` no longer changes the number: a sweep costs what
 * fitting its selected algorithms costs. It stays on `RuntimeInput` because
 * callers still pass it. Left alone: `ALGO_COST` is keyed on ids this
 * catalogue does not have (rf, svr, gbr...), so `random_forest`, `svm`,
 * `hist_gradient_boosting`, `grp`, `pls`, `lstm` and `gru` all fall back to
 * cost 1 — the numbers are invented, and inventing more is not this change.
 */
export function estimateRuntimeSeconds({
  rows,
  features,
  algorithms,
  targets,
  findBestParams,
  nEstimators,
  tuningVariants,
}: RuntimeInput): number {
  const cells = Math.max(rows, 1) * Math.max(features, 1)
  const trees = (nEstimators ?? 100) / 100

  const costs = selectedCosts(algorithms)
  const baseCost = costs.reduce((s, c) => s + c, 0) || 1
  // MODEL-FLOW-025-T06. Each algorithm's tuning cost is ITS variant count times
  // its cost; the mean over the selection stands for "whichever wins". With one
  // algorithm (a direct search) that is exact rather than 4x by assumption.
  const tuningCost =
    findBestParams && costs.length > 0
      ? costs.reduce(
          (s, c, i) =>
            s + (tuningVariants?.[algorithms[i]!] ?? TUNE_VARIANTS) * c,
          0,
        ) / costs.length
      : findBestParams
        ? TUNE_VARIANTS
        : 0

  return Math.max(
    2,
    cells *
      SEC_PER_CELL *
      trees *
      (baseCost + tuningCost) *
      Math.max(targets, 1),
  )
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return s ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
