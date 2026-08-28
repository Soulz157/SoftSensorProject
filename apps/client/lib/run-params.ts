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
import type {
  ModelRunSplitSpec,
  ModelTrainingRun,
} from '@/services/model-draft'

/**
 * Exactly the hyperparameter keys each `build_model` branch reads via
 * `.get(key, default)` — never a `**kwargs` splat, so this is a fixed,
 * enumerable set per algorithm, not a runtime question. `lstm`/`gru` raise
 * unconditionally in `build_model` (no windowing pipeline yet) and cannot
 * appear on a real run row; kept here only so the type is total.
 */
export const CONSUMED_HYPERPARAM_KEYS: Record<Algorithm, string[]> = {
  ols: ['fit_intercept'],
  ridge: ['alpha'],
  hist_gradient_boosting: ['learning_rate', 'n_estimators', 'num_leaves'],
  svm: ['C', 'kernel', 'epsilon'],
  mlp: ['hidden_layer_sizes', 'alpha', 'max_iter'],
  grp: ['alpha', 'n_restarts_optimizer'],
  pls: ['n_components', 'max_iter'],
  random_forest: ['n_estimators', 'max_depth'],
  lightgbm: ['learning_rate', 'num_leaves', 'boosting_type'],
  xgboost: ['n_estimators', 'learning_rate', 'max_depth'],
  lstm: [],
  gru: [],
}

/**
 * `seed` is generated and recorded on every run (model-run-launch.authorized
 * .service.ts), but `train.py` only forwards it as `random_state` to these
 * six estimators — ridge/ols/svm/pls never see it. A bare seed value is more
 * misleading here than an unconsumed hyperparameter, since it is present on
 * every run regardless of whether it did anything.
 */
export const SEED_CONSUMING_ALGORITHMS: Algorithm[] = [
  'hist_gradient_boosting',
  'mlp',
  'grp',
  'random_forest',
  'lightgbm',
  'xgboost',
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
