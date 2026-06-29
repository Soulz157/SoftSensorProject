/**
 * Retrain configuration + log scripting (single source of truth).
 *
 * Pure module — no React, no IO. Backs the Auto/Custom Finetune retrain flow.
 * Retraining is a simulation today (no training infra yet): the hook drives real
 * `deployStatus` + appends real logs, but the regression-model choice and
 * hyperparameters defined here are client-side only (no backend persistence).
 */

export type RegressionModel =
  | 'linear'
  | 'ridge'
  | 'lasso'
  | 'random_forest'
  | 'xgboost'

export type RetrainParam =
  | 'testSplit'
  | 'learningRate'
  | 'nEstimators'
  | 'alpha'

export interface RetrainConfig {
  model: RegressionModel
  testSplit: number
  learningRate: number
  nEstimators: number
  alpha: number
}

export interface RegressionModelMeta {
  value: RegressionModel
  label: string
  /** Hyperparameters relevant to this model (drives which inputs render). */
  params: RetrainParam[]
}

export const REGRESSION_MODELS: RegressionModelMeta[] = [
  { value: 'linear', label: 'Linear Regression', params: ['testSplit'] },
  { value: 'ridge', label: 'Ridge Regression', params: ['testSplit', 'alpha'] },
  { value: 'lasso', label: 'Lasso Regression', params: ['testSplit', 'alpha'] },
  {
    value: 'random_forest',
    label: 'Random Forest',
    params: ['testSplit', 'nEstimators'],
  },
  {
    value: 'xgboost',
    label: 'XGBoost',
    params: ['testSplit', 'nEstimators', 'learningRate'],
  },
]

export const DEFAULT_RETRAIN_CONFIG: RetrainConfig = {
  model: 'xgboost',
  testSplit: 0.2,
  learningRate: 0.1,
  nEstimators: 200,
  alpha: 1.0,
}

export interface ParamMeta {
  label: string
  min: number
  max: number
  step: number
}

export const PARAM_META: Record<RetrainParam, ParamMeta> = {
  testSplit: { label: 'Test Split', min: 0.1, max: 0.5, step: 0.05 },
  learningRate: { label: 'Learning Rate', min: 0.01, max: 1, step: 0.01 },
  nEstimators: { label: 'Estimators', min: 50, max: 1000, step: 50 },
  alpha: { label: 'Regularization α', min: 0, max: 10, step: 0.1 },
}

export function modelLabel(model: RegressionModel): string {
  return REGRESSION_MODELS.find(m => m.value === model)?.label ?? model
}

/** Phases of a (simulated) retrain run, in order. */
export type RetrainPhase =
  | 'idle'
  | 'training'
  | 'validating'
  | 'evaluating'
  | 'done'
  | 'error'

export interface EvalMetrics {
  rmse: number
  r2: number
  mae: number
}

/** Ordered stage boxes shown in the retrain progress UI. */
export const RETRAIN_STAGES: {
  key: 'training' | 'validating' | 'evaluating'
  label: string
}[] = [
  { key: 'training', label: 'Training' },
  { key: 'validating', label: 'Validating' },
  { key: 'evaluating', label: 'Result' },
]

/**
 * Deterministic mock eval metrics, seeded from model id (+ regression model).
 * No real evaluation infra yet — stable per model so re-runs match.
 */
export function buildMockMetrics(
  modelId: string,
  config?: RetrainConfig,
): EvalMetrics {
  const seedStr = `${modelId}:${config?.model ?? 'auto'}`
  let h = 0
  for (let i = 0; i < seedStr.length; i++) {
    h = (h << 5) - h + seedStr.charCodeAt(i)
    h |= 0
  }
  // three independent pseudo-random fractions in [0, 1)
  const frac = (n: number) => {
    const x = Math.sin(h + n * 97.13) * 43758.5453
    return x - Math.floor(x)
  }
  const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d
  return {
    rmse: round(0.05 + frac(1) * 0.45),
    r2: round(0.85 + frac(2) * 0.14),
    mae: round(0.04 + frac(3) * 0.36),
  }
}

export function paramsFor(model: RegressionModel): RetrainParam[] {
  return REGRESSION_MODELS.find(m => m.value === model)?.params ?? ['testSplit']
}

/** Ordered log lines emitted (one per tick) during a simulated retrain run. */
export function buildRetrainLogs(
  mode: 'auto' | 'custom',
  config?: RetrainConfig,
): string[] {
  if (mode === 'custom' && config) {
    const parts = paramsFor(config.model).map(
      p => `${PARAM_META[p].label}=${config[p]}`,
    )
    return [
      `Custom fine-tune started — ${modelLabel(config.model)}`,
      'Loading training dataset…',
      `Hyperparameters: ${parts.join(', ')}`,
      'Training in progress…',
      'Validation RMSE improved over previous checkpoint',
      'Deploying updated model…',
    ]
  }

  return [
    'Auto fine-tune started — searching for the best regression model',
    'Loading training dataset…',
    'Cross-validating candidate models (Linear, Ridge, Random Forest, XGBoost)…',
    'Selected best model by validation RMSE',
    'Training in progress…',
    'Deploying updated model…',
  ]
}
