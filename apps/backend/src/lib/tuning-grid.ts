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
 * `lstm`/`gru` gained an entry with MODEL-FLOW-024. Before it their absence
 * was a real gap, not dead code: `tuningCandidatesFor` returned `[]` for
 * them, so `expandSearchCandidates` threw its "No distinct hyperparameter
 * variants" 400 and Find Best Parameters simply could not tune a sequence
 * model. Their variants use only what `build_model` reads
 * (`epochs`/`hidden_size`/`batch_size`); `sequence_length` is deliberately
 * NOT in the table — it feeds windowing and the split spec, not `build_model`,
 * and `tuningCandidatesFor` carries the base run's own value across so a
 * variant is scored on the same rows the base was.
 *
 * MODEL-FLOW-024. The table below is the MEDIUM tier — what shipped before
 * sizing existed, and what an unknown dataset size resolves to. A dataset
 * with fewer or more ROWS picks one of the `TUNING_GRID_OVERRIDES` instead.
 * Those overrides are DECLARED PRIORS, not measured optima: MODEL-FLOW-020-T03
 * measured capacity against real holdouts at 32 and 59 distinct labelled
 * values and found no size-dependent ordering, and this scaling was added at
 * the user's request regardless. The tier keys on ROW COUNT (`sizeTierFor`,
 * the user's decision of 2026-09-21), reversing its first design on distinct
 * labelled values: a lab target forward-filled onto a fine grid makes 8,350
 * rows hold 32 observations (MODEL-FLOW-020 finding 1), and those
 * distinct-value tiers are what the override values below were written for.
 * LSTM/GRU `batch_size` keys on rows as well, because it sets steps per
 * epoch, a compute quantity.
 *
 * Every override value MUST sit inside the band the client form shows for the
 * same algorithm, key and tier (`apps/client/lib/hyperparam-ranges.ts`);
 * `apps/client/lib/__tests__/training-config-grid-agreement.test.ts` imports
 * this module and fails if one does not.
 */
export const TUNE_VARIANTS_PER_JOB = 4;

type HyperparamValue = string | number | boolean | null;
type HyperparamRecord = Record<string, HyperparamValue>;

const SEQUENCE_VARIANTS: HyperparamRecord[] = [
  { epochs: 30, hidden_size: 32, batch_size: 128 },
  { epochs: 100, hidden_size: 64, batch_size: 64 },
  { epochs: 50, hidden_size: 128, batch_size: 16 },
  { epochs: 75, hidden_size: 64, batch_size: 128 },
];

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
    {
      n_estimators: 300,
      max_depth: null,
      max_leaf_nodes: null,
      min_samples_leaf: 1,
      min_samples_split: 2,
    },
    {
      n_estimators: 200,
      max_depth: 10,
      max_leaf_nodes: 64,
      min_samples_leaf: 2,
      min_samples_split: 5,
    },
    {
      n_estimators: 500,
      max_depth: 20,
      max_leaf_nodes: 256,
      min_samples_leaf: 4,
      min_samples_split: 10,
    },
    {
      n_estimators: 100,
      max_depth: 5,
      max_leaf_nodes: 32,
      min_samples_leaf: 8,
      min_samples_split: 20,
    },
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
  // MODEL-FLOW-024. Sequence models. `batch_size` is clamped into the rows
  // band by `tuningVariantsFor`; the values here are the no-figure list.
  lstm: SEQUENCE_VARIANTS,
  gru: SEQUENCE_VARIANTS,
};

/**
 * MODEL-FLOW-024. How many ROWS the dataset holds, cut into four tiers.
 * `medium` is today's table; `tiny`/`small` shrink capacity, `large` widens
 * it. The edges are declared, not measured, and were chosen by the user as
 * durations of HOURLY data: tiny < 6 months, small 6-12 months, medium
 * 1-3 years, large > 3 years — 4,380 / 8,760 / 26,280 rows.
 *
 * The tier keys on the row COUNT, not the duration: the pipeline's interval is
 * per-dataset (`data_service.py` accepts `1d`/`1h`/`5m`/`30s`), so a 5-minute
 * dataset of 4,380 rows is 15 days, not 6 months. The months above are the
 * hourly reading of a row threshold, nothing more.
 *
 * MODEL-FLOW-020 measured that on this system rows and distinct labelled
 * values diverge by up to 260x (8,350 rows hold 32 distinct lab values), and
 * that a row tier therefore lands real datasets (4,470-15,441 rows) in
 * `small`/`medium` where a distinct-value tier put them in `tiny`/`small`.
 * The user chose rows anyway (2026-09-21); `distinctLabelled` is still
 * recorded on the job row but no longer picks anything.
 *
 * Mirrored in `apps/client/lib/hyperparam-ranges.ts`; the agreement test
 * compares the two at every boundary.
 */
export type SizeTier = 'tiny' | 'small' | 'medium' | 'large';

/** Lower bound of each tier above `tiny`, in rows (hourly: 6 months, 1 year, 3 years). */
export const SIZE_TIER_LOWER_BOUNDS = {
  small: 4380,
  medium: 8760,
  large: 26280,
} as const;

/** `null`/`undefined`/non-finite resolve to `medium`: no figure means today's table. */
export function sizeTierFor(rows: number | null | undefined): SizeTier {
  if (rows == null || !Number.isFinite(rows)) return 'medium';
  if (rows < SIZE_TIER_LOWER_BOUNDS.small) return 'tiny';
  if (rows < SIZE_TIER_LOWER_BOUNDS.medium) return 'small';
  if (rows < SIZE_TIER_LOWER_BOUNDS.large) return 'medium';
  return 'large';
}

/**
 * The dataset's size figures, all optional. `rows` drives every capacity
 * choice (the tier) and LSTM/GRU `batch_size`; `distinctLabelled` is carried
 * for the record only. Both come off the candidate job row (`sizedRowCount` /
 * `sizedDistinctLabelled`), which the client filled from its own /split-stats
 * response — accepted for tier selection only. They pick among fixed declared
 * lists and grant nothing the client cannot already do by sending arbitrary
 * hyperparameters itself.
 */
export interface DatasetSize {
  /** Recorded, never read for a tier since the user's row-count decision. */
  distinctLabelled?: number | null;
  rows?: number | null;
  /**
   * How many feature columns the training artifact has. Read only by `pls`,
   * whose `n_components` cannot exceed it (sklearn raises rather than
   * clamping — the trainer's own note in models.py), and read off the
   * artifact row (`DatasetArtifact.featureCount`), never the request.
   */
  features?: number | null;
}

/**
 * The tier's replacement for `TUNING_GRID[algorithm]`. Only algorithms with a
 * capacity dial appear: `ols`, `grp` and `pls` have no size prior anywhere in
 * this codebase and read the medium table in every tier, and `lstm`/`gru`
 * scale through `batch_size` alone (see `batchSizeBand`). An algorithm absent
 * here for a tier falls through to `TUNING_GRID`.
 *
 * RESOURCE SAFETY IS NOT MEASURED. The "declared priors" caveat above covers
 * accuracy, not memory or CPU: `large` reaches 600-wide MLPs, 800-tree
 * forests, 1,000 boosting rounds and 255 leaves, and none of it was run
 * against the trainer container's limits — unlike `GPR_MAX_TRAIN_ROWS` and
 * `LSTM_MAX_TRAIN_WINDOWS`, which were each set to a value actually measured.
 * `large` (26,280+ rows, three years of hourly data) IS reachable today: the
 * biggest GOLD artifact on this system holds 46,070 rows (MODEL-FLOW-020
 * finding 1), which the distinct-value tier this replaced never sent there.
 * The datasets measured for capacity (4,470-15,441 rows) are not that big, so
 * none of `large` has run against real data. Measure before a search does.
 */
export const TUNING_GRID_OVERRIDES: Record<
  Exclude<SizeTier, 'medium'>,
  Record<string, HyperparamRecord[]>
> = {
  tiny: {
    ridge: [{ alpha: 3 }, { alpha: 10 }, { alpha: 30 }, { alpha: 100 }],
    hist_gradient_boosting: [
      { learning_rate: 0.05, n_estimators: 100, num_leaves: 4 },
      { learning_rate: 0.1, n_estimators: 60, num_leaves: 7 },
      { learning_rate: 0.03, n_estimators: 150, num_leaves: 7 },
      { learning_rate: 0.3, n_estimators: 30, num_leaves: 3 },
    ],
    svm: [
      { C: 0.03, kernel: 'rbf', epsilon: 0.1 },
      { C: 0.3, kernel: 'rbf', epsilon: 0.05 },
      { C: 3, kernel: 'rbf', epsilon: 0.01 },
      { C: 0.1, kernel: 'linear', epsilon: 0.1 },
    ],
    mlp: [
      { hidden_layer_sizes: 16, alpha: 0.01, max_iter: 500 },
      { hidden_layer_sizes: 32, alpha: 0.1, max_iter: 500 },
      { hidden_layer_sizes: 8, alpha: 0.03, max_iter: 1000 },
      { hidden_layer_sizes: 64, alpha: 0.003, max_iter: 300 },
    ],
    random_forest: [
      {
        n_estimators: 100,
        max_depth: 4,
        max_leaf_nodes: 16,
        min_samples_leaf: 4,
        min_samples_split: 10,
      },
      {
        n_estimators: 200,
        max_depth: 6,
        max_leaf_nodes: 32,
        min_samples_leaf: 2,
        min_samples_split: 8,
      },
      {
        n_estimators: 50,
        max_depth: 3,
        max_leaf_nodes: 8,
        min_samples_leaf: 8,
        min_samples_split: 20,
      },
      {
        n_estimators: 150,
        max_depth: 8,
        max_leaf_nodes: 64,
        min_samples_leaf: 4,
        min_samples_split: 4,
      },
    ],
    lightgbm: [
      { learning_rate: 0.05, num_leaves: 7, boosting_type: 'gbdt' },
      { learning_rate: 0.1, num_leaves: 4, boosting_type: 'gbdt' },
      { learning_rate: 0.1, num_leaves: 15, boosting_type: 'dart' },
      { learning_rate: 0.03, num_leaves: 7, boosting_type: 'goss' },
    ],
    xgboost: [
      { n_estimators: 100, learning_rate: 0.05, max_depth: 3 },
      { n_estimators: 50, learning_rate: 0.1, max_depth: 2 },
      { n_estimators: 150, learning_rate: 0.03, max_depth: 4 },
      { n_estimators: 30, learning_rate: 0.3, max_depth: 3 },
    ],
  },
  small: {
    ridge: [{ alpha: 0.3 }, { alpha: 3 }, { alpha: 10 }, { alpha: 30 }],
    hist_gradient_boosting: [
      { learning_rate: 0.05, n_estimators: 150, num_leaves: 7 },
      { learning_rate: 0.1, n_estimators: 100, num_leaves: 15 },
      { learning_rate: 0.05, n_estimators: 300, num_leaves: 15 },
      { learning_rate: 0.2, n_estimators: 50, num_leaves: 4 },
    ],
    svm: [
      { C: 0.1, kernel: 'rbf', epsilon: 0.1 },
      { C: 1, kernel: 'rbf', epsilon: 0.05 },
      { C: 10, kernel: 'rbf', epsilon: 0.01 },
      { C: 1, kernel: 'linear', epsilon: 0.1 },
    ],
    mlp: [
      { hidden_layer_sizes: 32, alpha: 0.001, max_iter: 500 },
      { hidden_layer_sizes: 64, alpha: 0.01, max_iter: 500 },
      { hidden_layer_sizes: 128, alpha: 0.0003, max_iter: 300 },
      { hidden_layer_sizes: 16, alpha: 0.03, max_iter: 1000 },
    ],
    random_forest: [
      {
        n_estimators: 150,
        max_depth: 6,
        max_leaf_nodes: 32,
        min_samples_leaf: 2,
        min_samples_split: 5,
      },
      {
        n_estimators: 300,
        max_depth: 10,
        max_leaf_nodes: 64,
        min_samples_leaf: 1,
        min_samples_split: 2,
      },
      {
        n_estimators: 100,
        max_depth: 4,
        max_leaf_nodes: 16,
        min_samples_leaf: 4,
        min_samples_split: 10,
      },
      {
        n_estimators: 200,
        max_depth: null,
        max_leaf_nodes: 128,
        min_samples_leaf: 2,
        min_samples_split: 20,
      },
    ],
    lightgbm: [
      { learning_rate: 0.05, num_leaves: 15, boosting_type: 'gbdt' },
      { learning_rate: 0.2, num_leaves: 7, boosting_type: 'gbdt' },
      { learning_rate: 0.1, num_leaves: 31, boosting_type: 'dart' },
      { learning_rate: 0.1, num_leaves: 15, boosting_type: 'goss' },
    ],
    xgboost: [
      { n_estimators: 150, learning_rate: 0.05, max_depth: 3 },
      { n_estimators: 100, learning_rate: 0.1, max_depth: 4 },
      { n_estimators: 300, learning_rate: 0.03, max_depth: 4 },
      { n_estimators: 50, learning_rate: 0.3, max_depth: 6 },
    ],
  },
  large: {
    ridge: [{ alpha: 0.001 }, { alpha: 0.01 }, { alpha: 0.1 }, { alpha: 10 }],
    hist_gradient_boosting: [
      { learning_rate: 0.05, n_estimators: 400, num_leaves: 31 },
      { learning_rate: 0.1, n_estimators: 300, num_leaves: 63 },
      { learning_rate: 0.03, n_estimators: 800, num_leaves: 63 },
      { learning_rate: 0.05, n_estimators: 200, num_leaves: 127 },
    ],
    svm: [
      { C: 1, kernel: 'rbf', epsilon: 0.1 },
      { C: 30, kernel: 'rbf', epsilon: 0.01 },
      { C: 3, kernel: 'linear', epsilon: 0.1 },
      { C: 300, kernel: 'poly', epsilon: 0.05 },
    ],
    mlp: [
      { hidden_layer_sizes: 200, alpha: 0.00001, max_iter: 500 },
      { hidden_layer_sizes: 400, alpha: 0.0001, max_iter: 800 },
      { hidden_layer_sizes: 600, alpha: 0.000001, max_iter: 1000 },
      { hidden_layer_sizes: 100, alpha: 0.001, max_iter: 500 },
    ],
    random_forest: [
      {
        n_estimators: 400,
        max_depth: null,
        max_leaf_nodes: null,
        min_samples_leaf: 1,
        min_samples_split: 2,
      },
      {
        n_estimators: 300,
        max_depth: 15,
        max_leaf_nodes: 256,
        min_samples_leaf: 2,
        min_samples_split: 5,
      },
      {
        n_estimators: 800,
        max_depth: 30,
        max_leaf_nodes: 1024,
        min_samples_leaf: 1,
        min_samples_split: 2,
      },
      {
        n_estimators: 200,
        max_depth: 8,
        max_leaf_nodes: 64,
        min_samples_leaf: 4,
        min_samples_split: 10,
      },
    ],
    lightgbm: [
      { learning_rate: 0.05, num_leaves: 127, boosting_type: 'gbdt' },
      { learning_rate: 0.1, num_leaves: 63, boosting_type: 'gbdt' },
      { learning_rate: 0.1, num_leaves: 63, boosting_type: 'dart' },
      { learning_rate: 0.1, num_leaves: 127, boosting_type: 'goss' },
    ],
    xgboost: [
      { n_estimators: 500, learning_rate: 0.05, max_depth: 6 },
      { n_estimators: 300, learning_rate: 0.1, max_depth: 8 },
      { n_estimators: 1000, learning_rate: 0.03, max_depth: 6 },
      { n_estimators: 200, learning_rate: 0.2, max_depth: 12 },
    ],
  },
};

const SEQUENCE_ALGORITHMS = new Set(['lstm', 'gru']);

/**
 * MODEL-FLOW-024. PLS cannot fit more components than the data has features:
 * `PLSRegression(n_components > n_features)` raises at fit time, and
 * `build_model` deliberately does not clamp (models.py: "sklearn already
 * raises a clear ValueError"). A variant asking for 6 components on a
 * 4-feature dataset is therefore a container spawn that dies on arrival —
 * and a candidate failure fails the WHOLE job. So the grid is capped here,
 * where the feature count is known, and any variant that becomes an EXACT
 * duplicate of an earlier one is dropped.
 *
 * Returns `table` itself, unchanged, when nothing needs capping (feature
 * count unknown, or already at least the largest `n_components`) — the same
 * "served, not copied" rule every other path here keeps.
 */
function capComponents(
  table: HyperparamRecord[],
  features: number | null | undefined,
): HyperparamRecord[] {
  if (features == null || !Number.isFinite(features) || features < 1) {
    return table;
  }
  const cap = Math.floor(features);
  if (table.every((variant) => Number(variant.n_components) <= cap)) {
    return table;
  }
  const seen = new Set<string>();
  const capped: HyperparamRecord[] = [];
  for (const variant of table) {
    const next = {
      ...variant,
      n_components: Math.min(Number(variant.n_components), cap),
    };
    const key = JSON.stringify(next);
    if (seen.has(key)) continue;
    seen.add(key);
    capped.push(next);
  }
  return capped;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

/**
 * MODEL-FLOW-024. The `batch_size` band for LSTM/GRU given the dataset's row
 * count: at most an eighth of the rows (so an epoch is at least ~8 gradient
 * steps), never above 128, never below 8, with a floor of a quarter of that
 * cap. `rows` unknown gives 16-128 — the band the form always showed — and
 * so does any dataset of 1,024+ rows: on the real datasets seen so far
 * (4,470-15,441 source rows) this cap does not bind. It matters only for
 * small data.
 *
 * Keyed on rows, like the size tier: batch size sets steps per epoch, a
 * compute quantity, and every row is a training window whether or not its
 * target repeats its neighbour's. Uses SOURCE rows
 * (the figure the job row records) rather than training windows; that
 * overstates the cap by at most the split ratio.
 */
export function batchSizeBand(rows: number | null | undefined): {
  min: number;
  max: number;
} {
  if (rows == null || !Number.isFinite(rows)) return { min: 16, max: 128 };
  const max = clamp(Math.floor(rows / 8), 8, 128);
  const min = clamp(Math.floor(max / 4), 4, 16);
  return { min, max };
}

/**
 * Every variant Find Best Parameters may try for `algorithm` at this dataset
 * size, before the already-tried exclusion and the per-job cap. With no
 * `size` (or a `medium` figure) this IS `TUNING_GRID[algorithm]`, the same
 * array — "served, not copied" — so the endpoint and the job builder cannot
 * disagree. `[]` for an unknown algorithm.
 *
 * THE IDENTITY IS LOAD-BEARING, NOT A NICETY. `TuningGridAuthorizedService.get`
 * derives its `sized` flag from `variants !== TUNING_GRID[algorithm]`, and the
 * Custom Finetune form tells the operator "sized to this model's own data" on
 * that flag alone. So every path that applies NO sizing must return `table`
 * itself — non-sequence passthrough, the unbound batch-cap shortcut and
 * `capComponents`' early return — and a new branch that returns a fresh but
 * EQUAL array would flip the flag to `true` and make the form claim sizing that
 * is not there. `tuning-grid.authorized.service.spec.ts` pins the current
 * cases; this comment is what stops the next branch being written wrongly.
 */
export function tuningVariantsFor(
  algorithm: string,
  size?: DatasetSize,
): HyperparamRecord[] {
  const tier = sizeTierFor(size?.rows);
  const table =
    (tier === 'medium' ? undefined : TUNING_GRID_OVERRIDES[tier][algorithm]) ??
    TUNING_GRID[algorithm];
  if (!table) return [];
  if (algorithm === 'pls') return capComponents(table, size?.features);
  if (!SEQUENCE_ALGORITHMS.has(algorithm)) return table;
  const band = batchSizeBand(size?.rows);
  // An unbound cap (rows unknown, or 1,024+) is the 16-128 band every static
  // variant already sits inside, so clamping would change nothing — and
  // returning `table` itself keeps "served, not copied" true for lstm/gru too,
  // instead of allocating a fresh array of fresh objects per request.
  if (band.max >= 128) return table;
  return table.map((variant) => ({
    ...variant,
    batch_size: clamp(Number(variant.batch_size), band.min, band.max),
  }));
}

/** Order-independent equality for a flat hyperparameter record. */
function sameHyperparams(a: HyperparamRecord, b: HyperparamRecord): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, i) => key === bKeys[i] && a[key] === b[key]);
}

/**
 * True when the base run already covers this variant.
 *
 * TABULAR algorithms keep the original whole-record equality
 * (`sameHyperparams`), byte for byte: a base carrying a key no variant names
 * is NOT treated as covering it. MODEL-FLOW-024 briefly widened this to every
 * algorithm and that silently narrowed what a retrain search tries for a base
 * with extra keys, so it is scoped back.
 *
 * lstm/gru compare on the VARIANT's keys only: their base also carries
 * `sequence_length`, which no variant names (it is not tuned), so a
 * whole-record comparison would never match and the base would come back as
 * its own tuning variant.
 */
function alreadyCovered(
  algorithm: string,
  variant: HyperparamRecord,
  alreadyTried: HyperparamRecord,
): boolean {
  if (!SEQUENCE_ALGORITHMS.has(algorithm)) {
    return sameHyperparams(variant, alreadyTried);
  }
  const keys = Object.keys(variant);
  return (
    keys.length > 0 && keys.every((key) => alreadyTried[key] === variant[key])
  );
}

/**
 * Phase-2 candidates for a "Find Best Parameters" job, given the phase-1
 * winner's own algorithm and hyperparameters. Excludes any variant
 * identical to what already ran (never re-run the winner's own setting),
 * then caps at `TUNE_VARIANTS_PER_JOB`. Returns `[]` for an algorithm with
 * no grid entry (unknown algorithm) rather than throwing — the caller treats
 * an empty result as "nothing left to tune."
 *
 * MODEL-FLOW-024. `size` picks the tier (see `sizeTierFor`); omitted means
 * `medium`, the table that shipped before sizing existed. For `lstm`/`gru`
 * every variant also carries the base run's `sequence_length`: it is not
 * tuned, and dropping it would silently retrain on the trainer's default
 * window and score a different set of rows than the base did.
 */
export function tuningCandidatesFor(
  algorithm: string,
  alreadyTried: HyperparamRecord,
  size?: DatasetSize,
): HyperparamRecord[] {
  const carried: HyperparamRecord =
    SEQUENCE_ALGORITHMS.has(algorithm) &&
    typeof alreadyTried.sequence_length === 'number'
      ? { sequence_length: alreadyTried.sequence_length }
      : {};
  return tuningVariantsFor(algorithm, size)
    .filter((variant) => !alreadyCovered(algorithm, variant, alreadyTried))
    .slice(0, TUNE_VARIANTS_PER_JOB)
    .map((variant) => ({ ...variant, ...carried }));
}
