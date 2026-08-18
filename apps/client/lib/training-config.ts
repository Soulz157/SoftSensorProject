/**
 * Training-config field catalog for the Create Model wizard's Step 2.
 *
 * Pure module (no React / IO): the single source of truth for which
 * hyperparameters each algorithm exposes, the available loss functions, and the
 * clean default hyperparameter set for an algorithm. Consumed by the Phase-2
 * `dynamic-hyperparameters` / `core-config` components and by the nav hook
 * (`defaultHyperparams` on algorithm switch). Keep UI thin — add new algorithm
 * knobs here, not in the component.
 */
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'

/** A single hyperparameter control, discriminated by `kind` (drives the rendered input). */
export type HyperparamField =
  | {
      kind: 'number'
      key: string
      label: string
      defaultValue: number
      step?: number
      min?: number
      max?: number
    }
  | { kind: 'checkbox'; key: string; label: string; defaultValue: boolean }
  | {
      /** Number input with an "unlimited" toggle — the value is `null` when unlimited. */
      kind: 'nullable-number'
      key: string
      label: string
      defaultValue: number | null
    }
  | {
      kind: 'select'
      key: string
      label: string
      defaultValue: string
      options: { value: string; label: string }[]
    }

/** Per-algorithm hyperparameter catalog. Order here is the render order. */
export const HYPERPARAMS: Record<Algorithm, HyperparamField[]> = {
  ols: [
    {
      kind: 'checkbox',
      key: 'fit_intercept',
      label: 'Fit intercept',
      defaultValue: true,
    },
  ],
  svm: [
    {
      kind: 'number',
      key: 'C',
      label: 'C (regularization)',
      defaultValue: 1.0,
      step: 0.1,
      min: 0,
    },
    {
      kind: 'select',
      key: 'kernel',
      label: 'Kernel',
      defaultValue: 'rbf',
      options: [
        { value: 'rbf', label: 'rbf' },
        { value: 'linear', label: 'linear' },
        { value: 'poly', label: 'poly' },
        { value: 'sigmoid', label: 'sigmoid' },
      ],
    },
    {
      kind: 'number',
      key: 'epsilon',
      label: 'Epsilon',
      defaultValue: 0.1,
      step: 0.01,
      min: 0,
    },
  ],
  mlp: [
    {
      kind: 'number',
      key: 'hidden_layer_sizes',
      label: 'Hidden layer size',
      defaultValue: 100,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'alpha',
      label: 'Alpha (L2)',
      defaultValue: 0.0001,
      step: 0.0001,
      min: 0,
    },
    {
      kind: 'number',
      key: 'max_iter',
      label: 'Max iterations',
      defaultValue: 200,
      step: 10,
      min: 1,
    },
  ],
  grp: [
    {
      kind: 'number',
      key: 'alpha',
      label: 'Alpha (noise)',
      defaultValue: 1e-10,
      min: 0,
    },
    {
      kind: 'number',
      key: 'n_restarts_optimizer',
      label: 'N-restarts optimizer',
      defaultValue: 0,
      step: 1,
      min: 0,
    },
  ],
  pls: [
    {
      kind: 'number',
      key: 'n_components',
      label: 'N-components',
      defaultValue: 2,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'max_iter',
      label: 'Max iterations',
      defaultValue: 500,
      step: 10,
      min: 1,
    },
  ],
  xgboost: [
    {
      kind: 'number',
      key: 'n_estimators',
      label: 'N-estimators',
      defaultValue: 100,
      step: 10,
      min: 1,
    },
    {
      kind: 'number',
      key: 'learning_rate',
      label: 'Learning rate',
      defaultValue: 0.1,
      step: 0.01,
      min: 0,
    },
    {
      kind: 'number',
      key: 'max_depth',
      label: 'Max depth',
      defaultValue: 6,
      step: 1,
      min: 1,
    },
  ],
  random_forest: [
    {
      kind: 'number',
      key: 'n_estimators',
      label: 'N-estimators',
      defaultValue: 100,
      step: 10,
      min: 1,
    },
    {
      kind: 'nullable-number',
      key: 'max_depth',
      label: 'Max depth',
      defaultValue: null,
    },
  ],
  lightgbm: [
    {
      kind: 'number',
      key: 'learning_rate',
      label: 'Learning rate',
      defaultValue: 0.1,
      step: 0.01,
      min: 0,
    },
    {
      kind: 'number',
      key: 'num_leaves',
      label: 'Num leaves',
      defaultValue: 31,
      step: 1,
      min: 2,
    },
    {
      kind: 'select',
      key: 'boosting_type',
      label: 'Boosting type',
      defaultValue: 'gbdt',
      options: [
        { value: 'gbdt', label: 'gbdt' },
        { value: 'dart', label: 'dart' },
        { value: 'goss', label: 'goss' },
      ],
    },
  ],
  lstm: [
    {
      kind: 'number',
      key: 'epochs',
      label: 'Epochs',
      defaultValue: 50,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'batch_size',
      label: 'Batch size',
      defaultValue: 32,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'hidden_size',
      label: 'Hidden size',
      defaultValue: 64,
      step: 1,
      min: 1,
    },
  ],
  gru: [
    {
      kind: 'number',
      key: 'epochs',
      label: 'Epochs',
      defaultValue: 50,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'batch_size',
      label: 'Batch size',
      defaultValue: 32,
      step: 1,
      min: 1,
    },
    {
      kind: 'number',
      key: 'hidden_size',
      label: 'Hidden size',
      defaultValue: 64,
      step: 1,
      min: 1,
    },
  ],
}

/** Available loss / evaluation functions. Wire value ↔ display label. */
export const LOSS_OPTIONS: { value: string; label: string }[] = [
  { value: 'mse', label: 'MSE' },
  { value: 'rmse', label: 'RMSE' },
  { value: 'mae', label: 'MAE' },
  { value: 'cross_entropy', label: 'Cross-Entropy' },
]

/** Build the clean default hyperparameter record for an algorithm (no leftover keys). */
export function defaultHyperparams(
  algorithm: Algorithm,
): Record<string, HyperparamValue> {
  const record: Record<string, HyperparamValue> = {}
  // `?? []` guards a legacy/unknown algorithm hydrated from a saved model, so an
  // absent catalog entry yields empty defaults instead of a "not iterable" throw.
  for (const field of HYPERPARAMS[algorithm] ?? []) {
    record[field.key] = field.defaultValue
  }
  return record
}
