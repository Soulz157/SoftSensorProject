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

/**
 * MODEL-FLOW-020-T05. Advisory only — a statement of what a reasonable band
 * looks like, NEVER a constraint on the input. The field keeps its single
 * default and the control keeps accepting whatever `min`/`max` allow; this is
 * the shape MODEL-FLOW-012-T05 chose for the Loss function control, which
 * stayed a control and gained a note about what it does and does not do.
 *
 * `note` states what the parameter DOES, in terms a reader can check against
 * the estimator's own documentation — "higher = stronger L2 shrinkage" is
 * checkable, "try 0.1" is folklore. Deliberately short: it renders under a
 * form field, not in a tooltip.
 *
 * THE BAND MUST CONTAIN EVERY VALUE `TUNING_GRID` ACTUALLY TRIES for the
 * same algorithm and key (this feature's finding 5). A form suggesting
 * 100-500 estimators beside a tuning phase that only tries 50-100 tells the
 * user two different things about one parameter. That agreement is NOT
 * maintained by hand: `__tests__/training-config-grid-agreement.test.ts`
 * reads the backend's own `tuning-grid.ts` source and fails if any grid value
 * falls outside the band declared here — the same static-source-guard
 * precedent `run-params.test.ts` and `tuning-grid.spec.ts` already follow
 * across this boundary.
 *
 * The band also contains the field's own `defaultValue`, for the obvious
 * reason that a form cannot ship a default it simultaneously calls out of
 * range.
 *
 * NOT DERIVED FROM DATASET SIZE, though this feature originally intended it
 * to be: MODEL-FLOW-020-T03 measured capacity against real holdouts at 32, 59
 * and 97 distinct labelled values, found three different orderings of the
 * same five settings, and closed as a no-op. There is no size-dependent
 * figure to show here because none was found to exist.
 */
export interface SuggestedRange {
  min: number
  max: number
  /** What the parameter does — checkable against the estimator's docs. */
  note: string
}

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
      suggestedRange?: SuggestedRange
    }
  | { kind: 'checkbox'; key: string; label: string; defaultValue: boolean }
  | {
      /** Number input with an "unlimited" toggle — the value is `null` when unlimited. */
      kind: 'nullable-number'
      key: string
      label: string
      defaultValue: number | null
      /** Describes the NUMERIC band only. `null` (unlimited) is a separate,
       *  deliberate choice the toggle already explains, and the grid's own
       *  `null` entry is excluded from the containment check for the same
       *  reason — it is not a value on this scale. */
      suggestedRange?: SuggestedRange
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
  ridge: [
    {
      kind: 'number',
      key: 'alpha',
      label: 'Alpha (regularization)',
      defaultValue: 1.0,
      step: 0.1,
      min: 0,
      suggestedRange: {
        min: 0.01,
        max: 100,
        note: 'higher = stronger L2 shrinkage toward zero',
      },
    },
  ],
  // Key names match `xgboost`/`lightgbm` below on purpose, not `max_iter` /
  // `max_leaf_nodes` (the estimator's real kwargs) — train.py's
  // hist_gradient_boosting branch maps n_estimators→max_iter and
  // num_leaves→max_leaf_nodes so the three boosting algorithms present one
  // shared vocabulary to the user.
  hist_gradient_boosting: [
    {
      kind: 'number',
      key: 'learning_rate',
      label: 'Learning rate',
      defaultValue: 0.1,
      step: 0.01,
      min: 0,
      suggestedRange: {
        min: 0.01,
        max: 0.3,
        note: 'lower needs more estimators to reach the same fit',
      },
    },
    {
      kind: 'number',
      key: 'n_estimators',
      label: 'N-estimators',
      defaultValue: 200,
      step: 10,
      min: 1,
      suggestedRange: {
        min: 100,
        max: 500,
        note: 'boosting rounds (max_iter); pairs with learning_rate',
      },
    },
    {
      kind: 'number',
      key: 'num_leaves',
      label: 'Num leaves',
      defaultValue: 31,
      step: 1,
      min: 2,
      suggestedRange: {
        min: 7,
        max: 63,
        note: 'max_leaf_nodes; higher fits finer structure, overfits sooner',
      },
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
      suggestedRange: {
        min: 0.1,
        max: 100,
        note: 'higher = less regularisation, tighter fit to training points',
      },
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
      suggestedRange: {
        min: 0.01,
        max: 0.1,
        note: 'width of the no-penalty tube around the prediction',
      },
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
      suggestedRange: {
        min: 50,
        max: 300,
        note: 'width of the single hidden layer',
      },
    },
    {
      kind: 'number',
      key: 'alpha',
      label: 'Alpha (L2)',
      defaultValue: 0.0001,
      step: 0.0001,
      min: 0,
      suggestedRange: {
        min: 0.00001,
        max: 0.01,
        note: 'L2 penalty on the weights',
      },
    },
    {
      kind: 'number',
      key: 'max_iter',
      label: 'Max iterations',
      defaultValue: 200,
      step: 10,
      min: 1,
      suggestedRange: {
        min: 200,
        max: 1000,
        note: 'optimiser cap; raise it if convergence warnings appear',
      },
    },
  ],
  grp: [
    {
      kind: 'number',
      key: 'alpha',
      label: 'Alpha (noise)',
      defaultValue: 1e-10,
      min: 0,
      suggestedRange: {
        min: 1e-10,
        max: 0.001,
        note: 'jitter on the kernel diagonal; raise it if the fit fails to converge',
      },
    },
    {
      kind: 'number',
      key: 'n_restarts_optimizer',
      label: 'N-restarts optimizer',
      defaultValue: 0,
      step: 1,
      min: 0,
      suggestedRange: {
        min: 0,
        max: 10,
        note: 'restarts of the kernel hyperparameter search; each costs a full fit',
      },
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
      suggestedRange: {
        min: 1,
        max: 6,
        note: 'latent components; cannot exceed the feature count',
      },
    },
    {
      kind: 'number',
      key: 'max_iter',
      label: 'Max iterations',
      defaultValue: 500,
      step: 10,
      min: 1,
      suggestedRange: {
        min: 250,
        max: 1000,
        note: 'NIPALS iteration cap per component',
      },
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
      suggestedRange: {
        min: 100,
        max: 500,
        note: 'boosting rounds; pairs with learning_rate',
      },
    },
    {
      kind: 'number',
      key: 'learning_rate',
      label: 'Learning rate',
      defaultValue: 0.1,
      step: 0.01,
      min: 0,
      suggestedRange: {
        min: 0.01,
        max: 0.3,
        note: 'lower needs more estimators to reach the same fit',
      },
    },
    {
      kind: 'number',
      key: 'max_depth',
      label: 'Max depth',
      defaultValue: 6,
      step: 1,
      min: 1,
      suggestedRange: {
        min: 3,
        max: 10,
        note: 'tree depth; the dominant overfitting control for this estimator',
      },
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
      suggestedRange: {
        min: 100,
        max: 500,
        note: 'more trees only reduce variance — a forest does not overfit by count',
      },
    },
    {
      kind: 'nullable-number',
      key: 'max_depth',
      label: 'Max depth',
      defaultValue: null,
      suggestedRange: {
        min: 5,
        max: 20,
        note: 'unlimited grows each tree until its leaves are pure',
      },
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
      suggestedRange: {
        min: 0.01,
        max: 0.3,
        note: 'lower needs more boosting rounds to reach the same fit',
      },
    },
    {
      kind: 'number',
      key: 'num_leaves',
      label: 'Num leaves',
      defaultValue: 31,
      step: 1,
      min: 2,
      suggestedRange: {
        min: 15,
        max: 63,
        note: 'leaf-wise growth: the main capacity control, not depth',
      },
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
      suggestedRange: {
        min: 10,
        max: 200,
        note: 'full passes over the training windows',
      },
    },
    {
      kind: 'number',
      key: 'batch_size',
      label: 'Batch size',
      defaultValue: 32,
      step: 1,
      min: 1,
      suggestedRange: { min: 16, max: 128, note: 'windows per gradient step' },
    },
    {
      kind: 'number',
      key: 'hidden_size',
      label: 'Hidden size',
      defaultValue: 64,
      step: 1,
      min: 1,
      suggestedRange: { min: 32, max: 256, note: 'recurrent state width' },
    },
    // MODEL-FLOW-009-T03. Default kept in sync with DEFAULT_SEQUENCE_LENGTH
    // (images/trainer/train.py) — both are 24, not measured against any
    // real dataset since no lookback-window convention exists elsewhere in
    // this codebase yet. Still disabled inline (algorithm-selector.tsx)
    // until MODEL-FLOW-009-T04 lands the runtime.
    {
      kind: 'number',
      key: 'sequence_length',
      label: 'Sequence length',
      defaultValue: 24,
      step: 1,
      min: 1,
      suggestedRange: {
        min: 12,
        max: 168,
        note: 'lookback window in samples, not hours',
      },
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
      suggestedRange: {
        min: 10,
        max: 200,
        note: 'full passes over the training windows',
      },
    },
    {
      kind: 'number',
      key: 'batch_size',
      label: 'Batch size',
      defaultValue: 32,
      step: 1,
      min: 1,
      suggestedRange: { min: 16, max: 128, note: 'windows per gradient step' },
    },
    {
      kind: 'number',
      key: 'hidden_size',
      label: 'Hidden size',
      defaultValue: 64,
      step: 1,
      min: 1,
      suggestedRange: { min: 32, max: 256, note: 'recurrent state width' },
    },
    // MODEL-FLOW-009-T03. See the matching lstm entry's comment above.
    {
      kind: 'number',
      key: 'sequence_length',
      label: 'Sequence length',
      defaultValue: 24,
      step: 1,
      min: 1,
      suggestedRange: {
        min: 12,
        max: 168,
        note: 'lookback window in samples, not hours',
      },
    },
  ],
}

/**
 * Available loss / evaluation functions. Wire value ↔ display label.
 *
 * Recorded on the saved Model's config (Model.data.config.lossFunction) —
 * MODEL-FLOW-012's audit found this is NEVER sent to the trainer:
 * images/trainer/train.py has no loss/objective/criterion read anywhere, and
 * CreateTrainingRunSchema is `.strict()` so a client that tried would be
 * rejected. `cross_entropy` was dropped here for the same reason it was
 * already dead: build_model has no classifier branch — this pipeline is
 * regression-only.
 */
export const LOSS_OPTIONS: { value: string; label: string }[] = [
  { value: 'r2', label: 'R2' },
  { value: 'rmse', label: 'RMSE' },
  { value: 'mae', label: 'MAE' },
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
