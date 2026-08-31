import { describe, it, expect } from 'vitest'
import { defaultHyperparams, HYPERPARAMS } from '@/lib/training-config'
import { ALGORITHMS, type Algorithm } from '@/store/model-pipeline'

/**
 * `defaultHyperparams` is the client's source of truth for what the wizard
 * sends the trainer — images/trainer/train.py's `build_model` reads these
 * exact key names with `hyperparameters.get(KEY, DEFAULT)`. A mismatch here
 * silently degrades to a default in the container with no error anywhere,
 * so the key SETS are pinned per algorithm, not just spot-checked.
 */
describe('defaultHyperparams', () => {
  it('covers every catalogue algorithm (HYPERPARAMS is exhaustive by construction)', () => {
    for (const algorithm of ALGORITHMS) {
      expect(HYPERPARAMS[algorithm]).toBeDefined()
    }
  })

  const expectedKeys: Record<Algorithm, string[]> = {
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
    // MODEL-FLOW-009-T03: sequence_length added alongside the existing
    // three — build_windows (images/trainer/train.py) reads it once
    // MODEL-FLOW-009-T04 wires the windowing pipeline into main().
    lstm: ['epochs', 'batch_size', 'hidden_size', 'sequence_length'],
    gru: ['epochs', 'batch_size', 'hidden_size', 'sequence_length'],
  }

  for (const [algorithm, keys] of Object.entries(expectedKeys) as [
    Algorithm,
    string[],
  ][]) {
    it(`${algorithm} produces exactly its documented keys`, () => {
      expect(Object.keys(defaultHyperparams(algorithm)).sort()).toEqual(
        [...keys].sort(),
      )
    })
  }

  it('ridge and hist_gradient_boosting are reachable — the T10 catalogue/trainer gap this task closes', () => {
    // Before this task, build_model implemented ridge/hist_gradient_boosting
    // but the UI catalogue never offered them; the catalogue offered 9 ids
    // build_model didn't implement. This pins the catalogue side of the fix.
    expect(ALGORITHMS).toContain('ridge')
    expect(ALGORITHMS).toContain('hist_gradient_boosting')
    expect(defaultHyperparams('ridge')).toEqual({ alpha: 1.0 })
  })

  it('returns an empty record for an unknown/legacy algorithm rather than throwing', () => {
    // `HYPERPARAMS[algorithm] ?? []` guard, training-config.ts:275-285 — a
    // saved draft holding a retired algorithm id must hydrate, not crash.
    expect(defaultHyperparams('not_a_real_algorithm' as Algorithm)).toEqual({})
  })
})
