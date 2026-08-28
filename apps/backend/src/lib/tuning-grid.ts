/**
 * MODEL-FLOW-013-T11. A curated hyperparameter shortlist per algorithm, used
 * to build a "Find Best Parameters" job's phase-2 candidates once phase 1
 * ("Find Best Model") has a winner. Declared as data — deterministic,
 * reviewable, no search strategy (grid/random/bayesian) invented to explain
 * where a value came from.
 *
 * Every key here MUST match what `images/trainer/train.py`'s `build_model`
 * actually reads for that algorithm — including its deliberate vocabulary
 * mismatches: `hist_gradient_boosting` takes `n_estimators`/`num_leaves`
 * (mapped inside train.py to `max_iter`/`max_leaf_nodes`), `mlp` takes a
 * SCALAR `hidden_layer_sizes`, `random_forest`'s `max_depth` may be `null`,
 * `lightgbm`'s `boosting_type` is one of `gbdt`/`dart`/`goss`. Values must
 * satisfy `HyperparametersSchema`
 * (dto/model-run.authorized.dto.ts) — string, number, boolean, or null only.
 *
 * `lstm`/`gru` have no entry: both are refused before a container is ever
 * spawned (`TrainingAlgorithmEnum` omits them), so a grid for them would be
 * dead code that looks live.
 */
export const TUNE_VARIANTS_PER_JOB = 4;

type HyperparamValue = string | number | boolean | null;
type HyperparamRecord = Record<string, HyperparamValue>;

export const TUNING_GRID: Record<string, HyperparamRecord[]> = {
  ols: [{ fit_intercept: false }],
  ridge: [{ alpha: 0.01 }, { alpha: 0.1 }, { alpha: 10 }, { alpha: 100 }],
  hist_gradient_boosting: [
    { learning_rate: 0.05, n_estimators: 300, num_leaves: 15 },
    { learning_rate: 0.3, n_estimators: 100, num_leaves: 31 },
    { learning_rate: 0.05, n_estimators: 500, num_leaves: 63 },
    { learning_rate: 0.1, n_estimators: 200, num_leaves: 7 },
  ],
  svm: [
    { C: 0.1, kernel: 'rbf', epsilon: 0.1 },
    { C: 10, kernel: 'rbf', epsilon: 0.01 },
    { C: 1, kernel: 'linear', epsilon: 0.1 },
    { C: 100, kernel: 'poly', epsilon: 0.05 },
  ],
  mlp: [
    { hidden_layer_sizes: 50, alpha: 0.0001, max_iter: 500 },
    { hidden_layer_sizes: 200, alpha: 0.001, max_iter: 500 },
    { hidden_layer_sizes: 100, alpha: 0.01, max_iter: 1000 },
    { hidden_layer_sizes: 300, alpha: 0.00001, max_iter: 300 },
  ],
  grp: [
    { alpha: 1e-8, n_restarts_optimizer: 2 },
    { alpha: 1e-5, n_restarts_optimizer: 5 },
    { alpha: 1e-3, n_restarts_optimizer: 0 },
    { alpha: 1e-10, n_restarts_optimizer: 10 },
  ],
  pls: [
    { n_components: 1, max_iter: 500 },
    { n_components: 4, max_iter: 500 },
    { n_components: 6, max_iter: 1000 },
    { n_components: 3, max_iter: 250 },
  ],
  random_forest: [
    { n_estimators: 300, max_depth: null },
    { n_estimators: 200, max_depth: 10 },
    { n_estimators: 500, max_depth: 20 },
    { n_estimators: 100, max_depth: 5 },
  ],
  lightgbm: [
    { learning_rate: 0.05, num_leaves: 63, boosting_type: 'gbdt' },
    { learning_rate: 0.3, num_leaves: 15, boosting_type: 'gbdt' },
    { learning_rate: 0.1, num_leaves: 31, boosting_type: 'dart' },
    { learning_rate: 0.1, num_leaves: 31, boosting_type: 'goss' },
  ],
  xgboost: [
    { n_estimators: 300, learning_rate: 0.05, max_depth: 4 },
    { n_estimators: 100, learning_rate: 0.3, max_depth: 3 },
    { n_estimators: 500, learning_rate: 0.05, max_depth: 8 },
    { n_estimators: 200, learning_rate: 0.1, max_depth: 10 },
  ],
};

/** Order-independent equality for a flat hyperparameter record. */
function sameHyperparams(a: HyperparamRecord, b: HyperparamRecord): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, i) => key === bKeys[i] && a[key] === b[key]);
}

/**
 * Phase-2 candidates for a "Find Best Parameters" job, given the phase-1
 * winner's own algorithm and hyperparameters. Excludes any variant
 * identical to what already ran (never re-run the winner's own setting),
 * then caps at `TUNE_VARIANTS_PER_JOB`. Returns `[]` for an algorithm with
 * no grid entry (unknown algorithm, or `lstm`/`gru`) rather than throwing —
 * the caller treats an empty result as "nothing left to tune."
 */
export function tuningCandidatesFor(
  algorithm: string,
  alreadyTried: HyperparamRecord,
): HyperparamRecord[] {
  const grid = TUNING_GRID[algorithm] ?? [];
  return grid
    .filter((variant) => !sameHyperparams(variant, alreadyTried))
    .slice(0, TUNE_VARIANTS_PER_JOB);
}
