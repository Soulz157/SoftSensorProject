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
  // MEASURED 2026-11-05 (scgc/soft-sensor-trainer:1.0.27, one fit, 100 trees,
  // default depth, 80% of the rows as training, 10k-60k rows x 10-20 features):
  // random_forest 104-151 and extra_trees 29-37 in this table's unit, where
  // lightgbm measured 0.6-1.7. Before these entries both fell back to 1, i.e.
  // priced like lightgbm — 120x and 33x too cheap — so a 30-minute forest
  // search read as seconds and the long-run notice never appeared. The middle
  // of each range is used; cost grows a little faster than linearly in rows
  // (random_forest 104 at 10k rows, 151 at 60k). A grid's shallower
  // combinations finish sooner than this default-depth fit, so a grid reads
  // high rather than low (one measured grid: 93s real vs ~188s here).
  random_forest: 120,
  extra_trees: 32,
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

/**
 * MODEL-FLOW-038. Of the ideal N-fold speed-up, the share a parallel grid
 * search actually gets. Measured on 2 workers under a 2-CPU cap: 1.8x on a
 * script, 1.5x through the real `run_grid_search` (109.8s -> 72.9s), with
 * identical results — worker start-up, the final fit and uneven combinations
 * eat the rest. 0.75 reproduces the more cautious of the two.
 */
export const PARALLEL_EFFICIENCY = 0.75

/** How much faster a search runs on `workers` processes than on one. */
export function searchSpeedup(workers: number | undefined): number {
  return workers !== undefined && workers > 1
    ? workers * PARALLEL_EFFICIENCY
    : 1
}

/**
 * The workers the trainer will use for a search — the same rule as
 * `search_parallelism` in images/trainer/app/pipelines/grid_search.py: only an
 * algorithm the server marks `parallel`, never more than the CPU budget or
 * than the number of fits, and none for a single fit or a one-CPU budget.
 * `tasks` is combinations x folds.
 */
export function searchWorkersFor(
  parallel: boolean,
  cpuBudget: number,
  tasks: number,
): number {
  if (!parallel || tasks < 2 || cpuBudget < 2) return 1
  return Math.min(cpuBudget, tasks)
}

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

  // Weighted by each algorithm's candidate count too, so an algorithm with
  // three added rows reads as three fits' worth of the total.
  const weights = selectedCosts(ids).map(
    (c, i) => c * (input.candidatesPerAlgorithm?.[ids[i]!] ?? 1),
  )
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
  findBestParams: boolean
  /**
   * How many first-round candidates each algorithm trains: its card plus the
   * rows the user added on it (`firstRoundFits`'s per-algorithm count). An
   * algorithm missing here counts once. Absent for a grid search on one
   * algorithm, whose added rows are priced in `tuningVariants` instead.
   */
  candidatesPerAlgorithm?: Partial<Record<string, number>>
  nEstimators?: number
  /**
   * MODEL-FLOW-025-T06. How many variants Find Best Parameters would actually
   * run for each algorithm — the Step 3 preview's count, after excluding what
   * the base already covers. An algorithm missing here falls back to
   * `TUNE_VARIANTS`, the cap, so an unknown count still over- rather than
   * under-estimates.
   */
  tuningVariants?: Partial<Record<string, number>>
  /**
   * MODEL-FLOW-029. Cross-Validation's k, when on. Every candidate then costs
   * k fold fits plus a refit. The fold fits train on growing subsets, so
   * pricing each as a full fit over- rather than under-estimates — the same
   * direction this file already errs in for an unknown variant count.
   */
  nSplits?: number
  /**
   * MODEL-FLOW-038. Fits a GridSearchCV search runs on ONE algorithm: every
   * combination on every fold (`fitCount`). Present only for a grid search,
   * which replaces the curated-variant pricing above — the trainer runs the
   * search inside one container, then fits the winner once (k folds + a refit
   * under CV) like any single run.
   */
  gridFits?: number
  /**
   * MODEL-FLOW-038. Processes the search is fitted on (`searchWorkersFor`).
   * Divides the SEARCH only, by `searchSpeedup`; the winner's own run is one
   * process. Absent or 1 = serial, so a caller that does not know it never
   * under-estimates.
   */
  searchWorkers?: number
}

/** Fits each candidate costs: 1, or k folds + the refit under CV. */
function fitsPerCandidate(nSplits: number | undefined): number {
  return nSplits !== undefined ? nSplits + 1 : 1
}

export interface CvFitCount {
  candidates: number
  fitsEach: number
  total: number
  /** MODEL-FLOW-038. Set for a grid search: the fits the search itself runs,
   *  on top of the `fitsEach` the winner then costs. `candidates` is 1. */
  searchFits?: number
}

/**
 * MODEL-FLOW-029. How many models a CV launch will fit, stated before Start —
 * the number a data scientist reads to decide whether k and the variant list
 * are worth it. Null when Cross-Validation is off. CV fits ONE algorithm (it
 * excludes a sweep), so the candidates are that algorithm's base fit plus,
 * with Find Best Parameters, its variants.
 */
export function cvFitCount(input: RuntimeInput): CvFitCount | null {
  if (input.nSplits === undefined) return null
  if (input.findBestParams && input.gridFits !== undefined) {
    const fitsEach = fitsPerCandidate(input.nSplits)
    return {
      candidates: 1,
      fitsEach,
      total: input.gridFits + fitsEach,
      searchFits: input.gridFits,
    }
  }
  const [algorithm] = input.algorithms
  const variants =
    input.findBestParams && algorithm
      ? (input.tuningVariants?.[algorithm] ?? TUNE_VARIANTS)
      : 0
  const own = algorithm ? (input.candidatesPerAlgorithm?.[algorithm] ?? 1) : 1
  const candidates = own + variants
  const fitsEach = fitsPerCandidate(input.nSplits)
  return { candidates, fitsEach, total: candidates * fitsEach }
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
 * 10x. A first round costs what fitting its candidates costs: each selected
 * algorithm times its own candidate count (the card plus added rows). Left
 * alone: `ALGO_COST` is keyed on ids this
 * catalogue does not have (rf, svr, gbr...), so `random_forest`, `svm`,
 * `grp`, `pls`, `lstm` and `gru` all fall back to
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
  candidatesPerAlgorithm,
  nSplits,
  gridFits,
  searchWorkers,
}: RuntimeInput): number {
  const cells = Math.max(rows, 1) * Math.max(features, 1)
  const trees = (nEstimators ?? 100) / 100

  const costs = selectedCosts(algorithms)
  // MODEL-FLOW-038. A grid search is the search's own fits plus the winner's
  // single run, all of ONE algorithm: `combos x folds + (folds + refit)`.
  if (findBestParams && gridFits !== undefined && costs.length === 1) {
    const cost = costs[0]!
    return Math.max(
      2,
      cells *
        SEC_PER_CELL *
        trees *
        cost *
        (gridFits / searchSpeedup(searchWorkers) + fitsPerCandidate(nSplits)) *
        Math.max(targets, 1),
    )
  }
  const baseCost =
    costs.reduce(
      (s, c, i) => s + c * (candidatesPerAlgorithm?.[algorithms[i]!] ?? 1),
      0,
    ) || 1
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
      fitsPerCandidate(nSplits) *
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
