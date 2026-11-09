/**
 * MODEL-FLOW-012 — pure derivations over a `ModelTrainingRun` row for the
 * Run Parameter Recall panel and its Apply action. No IO, no React.
 *
 * `CONSUMED_HYPERPARAM_KEYS` and `SEED_CONSUMING_ALGORITHMS` mirror
 * `images/trainer/train.py`'s `build_model` exactly — pinned by
 * `run-params.test.ts`'s static source guard, not by inspection. If a UI
 * knob is added to `HYPERPARAMS` (lib/training-config.ts) without a matching
 * `.get()` in `build_model`, that test fails rather than the panel silently
 * claiming the new value took effect.
 */
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { HYPERPARAMS } from '@/lib/training-config'
import { sourcedMetricsOf, type MetricSourceRun } from '@/lib/metric-source'
import type {
  ModelRunSplitSpec,
  ModelRunStatus,
  ModelTrainingRun,
} from '@/services/model-draft'

/**
 * Exactly the hyperparameter keys each `build_model` branch reads via
 * `.get(key, default)` — never a `**kwargs` splat, so this is a fixed,
 * enumerable set per algorithm, not a runtime question.
 *
 * MODEL-FLOW-014-T07 CORRECTION: `lstm`/`gru` do NOT raise unconditionally —
 * that was true before MODEL-FLOW-009-T04 built the windowing pipeline.
 * `build_model`'s lstm/gru branch now reads `hidden_size`/`epochs`/
 * `batch_size` via `hyperparameters.get(...)`, same as every other
 * algorithm. `sequence_length` is the one exception: it is consumed ONE
 * LEVEL UP, in `main()`'s `is_sequence` branch (`train.py:819-822`), before
 * `build_model` is ever called — `run-params.test.ts`'s guard scans that
 * block specifically for this key, rather than letting a build_model-only
 * extractor silently conclude it is unconsumed.
 */
export const CONSUMED_HYPERPARAM_KEYS: Record<Algorithm, string[]> = {
  ols: ['fit_intercept'],
  ridge: ['alpha', 'fit_intercept', 'solver'],
  svm: ['C', 'kernel', 'epsilon', 'tol', 'max_iter'],
  mlp: ['hidden_layer_sizes', 'alpha', 'max_iter'],
  grp: ['alpha', 'n_restarts_optimizer'],
  pls: ['n_components', 'max_iter'],
  random_forest: [
    'n_estimators',
    'max_depth',
    'max_leaf_nodes',
    'min_samples_leaf',
    'min_samples_split',
  ],
  extra_trees: [
    'n_estimators',
    'max_depth',
    'max_leaf_nodes',
    'min_samples_leaf',
    'min_samples_split',
  ],
  lightgbm: [
    'learning_rate',
    'num_leaves',
    'boosting_type',
    'n_estimators',
    'max_depth',
    'min_child_samples',
  ],
  xgboost: [
    'n_estimators',
    'learning_rate',
    'max_depth',
    'subsample',
    'colsample_bytree',
    'min_child_weight',
  ],
  lstm: ['hidden_size', 'epochs', 'batch_size', 'sequence_length'],
  gru: ['hidden_size', 'epochs', 'batch_size', 'sequence_length'],
}

/**
 * `seed` is generated and recorded on every run (model-run-launch.authorized
 * .service.ts). `train.py` forwards it to 9 of the 12 algorithms —
 * ols/svm/pls never see it. Seven as `random_state=seed` (the sklearn/
 * lightgbm/xgboost convention); `lstm`/`gru` as `seed=seed` on
 * `SequenceRegressor` instead (MODEL-FLOW-014-T07 CORRECTION — the prior
 * six-algorithm list predates MODEL-FLOW-009-T04's windowing pipeline and
 * was stale). MODEL-FLOW-027 added ridge: it always receives
 * `random_state=seed` now, though only its `sag`/`saga` solvers actually
 * consult it — the other five ignore it, same inert-until-used shape
 * `random_state` already has for grp's kernel. A bare seed value is more
 * misleading here than an unconsumed hyperparameter, since it is present on
 * every run regardless of whether it did anything.
 */
export const SEED_CONSUMING_ALGORITHMS: Algorithm[] = [
  'mlp',
  'grp',
  'random_forest',
  'extra_trees',
  'lightgbm',
  'xgboost',
  'ridge',
  'lstm',
  'gru',
]

export function seedConsumedBy(algorithm: string): boolean {
  return SEED_CONSUMING_ALGORITHMS.includes(algorithm as Algorithm)
}

export interface ClassifiedHyperparam {
  key: string
  label: string
  value: unknown
  consumed: boolean
}

/**
 * One row per key actually stored on the run — never per catalog entry, so
 * a legacy or fine-tuning-job run with a key `build_model` doesn't read
 * still shows up, labelled unconsumed, rather than being silently dropped.
 */
export function classifyHyperparams(
  algorithm: string,
  hyperparameters: Record<string, unknown> | null | undefined,
): ClassifiedHyperparam[] {
  if (!hyperparameters) return []
  const consumedKeys = CONSUMED_HYPERPARAM_KEYS[algorithm as Algorithm] ?? []
  const fields = HYPERPARAMS[algorithm as Algorithm] ?? []
  const labelFor = (key: string) =>
    fields.find(f => f.key === key)?.label ?? key

  return Object.entries(hyperparameters).map(([key, value]) => ({
    key,
    label: labelFor(key),
    value,
    consumed: consumedKeys.includes(key),
  }))
}

/**
 * `splitSpec.ratio` is a fraction (0.5–0.95); the Step 3 control is a
 * percentage. Convert once, here, at the client boundary — the same rule
 * `use-model-draft-sync.ts` and `use-model-training.ts` already follow in
 * the other direction.
 */
export function splitPercentFromRun(splitSpec: ModelRunSplitSpec): number {
  return Math.round(splitSpec.ratio * 100)
}

function isScalarHyperparamValue(value: unknown): value is HyperparamValue {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
}

export interface ApplyPatch {
  hyperparameters: Record<string, HyperparamValue>
  dropped: string[]
}

/**
 * Scalar-filters a run's hyperparameters before they're written back into
 * the wizard. MODEL-FLOW-012-T09 found both write paths that can put
 * hyperparameters on a run row already scalar-constrained by the same
 * `HyperparametersSchema` the PATCH enforces, so `dropped` is expected to be
 * empty for any run this system itself created — this only guards a legacy
 * row from a value the schema didn't yet constrain.
 */
export function toApplyPatch(
  run: Pick<ModelTrainingRun, 'hyperparameters'>,
): ApplyPatch {
  const hyperparameters: Record<string, HyperparamValue> = {}
  const dropped: string[] = []

  for (const [key, value] of Object.entries(run.hyperparameters ?? {})) {
    if (isScalarHyperparamValue(value)) {
      hyperparameters[key] = value
    } else {
      dropped.push(key)
    }
  }

  return { hyperparameters, dropped }
}

/**
 * Run list ordering for the Run Parameter Recall panel. The server returns
 * `createdAt desc` (listDraftRunsService) and that stays the default — these
 * are a READ-ONLY view preference over a copy of that list, so nothing about
 * which run is "latest" may be derived from this order (the panel pins that
 * by id against the unsorted array).
 *
 * A run has no user-supplied name: `name` here means the algorithm LABEL the
 * card actually renders, compared with `localeCompare` so the order matches
 * what is on screen rather than the raw enum key.
 */
export type RunSortKey = 'recent' | 'oldest' | 'name' | 'score' | 'status'

/**
 * MODEL-FLOW-035. The metric Step 3 ranks and displays runs by — the Loss
 * function setting, narrowed to the two choices it offers. Never sent to the
 * trainer; it only picks which of a run's own recorded figures is the
 * headline.
 */
export type ScoreMetric = 'rmse' | 'mae'

export const SCORE_METRIC_LABELS: Record<ScoreMetric, string> = {
  rmse: 'RMSE',
  mae: 'MAE',
}

/** Any Loss function value -> the metric it ranks by. Absent or unrecognised
 *  is RMSE, the same default `normaliseLossFunction` resolves to. */
export function scoreMetricOf(loss: string | null | undefined): ScoreMetric {
  return loss === 'mae' ? 'mae' : 'rmse'
}

export const RUN_SORT_LABELS: Record<RunSortKey, string> = {
  recent: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  score: 'Best score',
  status: 'Status',
}

/** "Best RMSE" / "Best MAE" for the score sort; the static label otherwise. */
export function runSortLabel(key: RunSortKey, metric: ScoreMetric): string {
  return key === 'score'
    ? `Best ${SCORE_METRIC_LABELS[metric]}`
    : RUN_SORT_LABELS[key]
}

/**
 * MODEL-FLOW-035. What a job's `bestRunId` was chosen by, in words: "lowest
 * Test MAE", or "lowest mean CV RMSE" for a cross-validated search. Reads the
 * JOB's metric, not the form's current Loss function, so a badge never
 * describes a rule the job did not use.
 */
export function rankingBasisText(
  rankingMetric: string | null | undefined,
  isCv: boolean,
): string {
  const label = SCORE_METRIC_LABELS[scoreMetricOf(rankingMetric)]
  return isCv ? `lowest mean CV ${label}` : `lowest Test ${label}`
}

export interface RunHeadline {
  /** The chosen metric's figure: the test split's, or a CV run's fold mean. */
  value: number | null
  /** Fold standard deviation; null for a non-CV run or an unrecorded std. */
  std: number | null
  r2: number | null
  r2Std: number | null
  isCv: boolean
}

/**
 * The figures a Run parameters card leads with: the chosen metric and R²,
 * both from the run's OWN recorded metrics (a CV run: mean ± std over its
 * folds). Choosing the metric is a view choice over what the run recorded —
 * it does not say the run was fit to that metric.
 */
export function runHeadlineOf(
  run: MetricSourceRun,
  metric: ScoreMetric,
): RunHeadline {
  const own = sourcedMetricsOf(run).find(
    m => m.source === 'test-split' || m.source === 'cv-fold-estimate',
  )
  if (!own)
    return { value: null, std: null, r2: null, r2Std: null, isCv: false }
  if (own.source === 'cv-fold-estimate') {
    return {
      value: own.mean[metric],
      std: own.std[metric],
      r2: own.mean.r2,
      r2Std: own.std.r2,
      isCv: true,
    }
  }
  return {
    value: own[metric],
    std: null,
    r2: own.r2,
    r2Std: null,
    isCv: false,
  }
}

/** Terminal-and-useful first, so a Status sort surfaces what can be compared
 *  or applied rather than burying it under a failed run. */
const STATUS_ORDER: Record<ModelRunStatus, number> = {
  SUCCEEDED: 0,
  RUNNING: 1,
  QUEUED: 2,
  FAILED: 3,
  CANCELED: 4,
}

type SortableRun = Pick<
  ModelTrainingRun,
  'algorithm' | 'createdAt' | 'status'
> &
  MetricSourceRun

function scoreOf(run: SortableRun, metric: ScoreMetric): number | null {
  return runHeadlineOf(run, metric).value
}

/**
 * Sorts a COPY — `runs` is the array `useDraftRuns` hands every consumer,
 * and Step 3 reads it in two components at once.
 *
 * `createdAt desc` is the tiebreak on every key, so equal names/metrics keep
 * a stable, meaningful order instead of jittering between renders. A run
 * with no RMSE (queued, running, failed) sorts last under `score` rather than
 * pretending to a score.
 */
export function sortRuns<T extends SortableRun>(
  runs: readonly T[],
  key: RunSortKey,
  labelOf: (algorithm: string) => string,
  metric: ScoreMetric = 'rmse',
): T[] {
  const byRecency = (a: SortableRun, b: SortableRun) =>
    b.createdAt.localeCompare(a.createdAt)

  return [...runs].sort((a, b) => {
    switch (key) {
      case 'recent':
        return byRecency(a, b)
      case 'oldest':
        return -byRecency(a, b)
      case 'name': {
        const cmp = labelOf(a.algorithm).localeCompare(labelOf(b.algorithm))
        return cmp !== 0 ? cmp : byRecency(a, b)
      }
      case 'score': {
        const x = scoreOf(a, metric)
        const y = scoreOf(b, metric)
        if (x === null && y === null) return byRecency(a, b)
        if (x === null) return 1
        if (y === null) return -1
        return x !== y ? x - y : byRecency(a, b)
      }
      case 'status': {
        const cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        return cmp !== 0 ? cmp : byRecency(a, b)
      }
    }
  })
}
