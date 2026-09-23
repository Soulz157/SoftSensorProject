import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  DEFAULT_LOSS_FUNCTION,
  HYPERPARAMS,
  LOSS_OPTIONS,
  defaultHyperparams,
  normaliseLossFunction,
} from '@/lib/training-config'
import { DEFAULT_RANK_METRIC } from '@/lib/metric-ranking'
import {
  ALGORITHMS,
  mpLossFunctionAtom,
  resetWizardAtom,
  type Algorithm,
} from '@/store/model-pipeline'

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
    // MODEL-FLOW-026: the three capacity knobs joined the original pair.
    random_forest: [
      'n_estimators',
      'max_depth',
      'max_leaf_nodes',
      'min_samples_leaf',
      'min_samples_split',
    ],
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

/**
 * MODEL-FLOW-019-T37. THE INVARIANT WHOSE ABSENCE LET THIS SHIP: the default
 * a wizard starts on must be a value the control can actually render.
 *
 * `mpLossFunctionAtom` defaulted to `'mse'`, which `LOSS_OPTIONS` has never
 * offered. A Radix `Select` given a value matching no item renders an EMPTY
 * trigger, so Step 3's Loss control came up blank on every fresh draft, and —
 * through two `?? 'mse'` hydration fallbacks — on every one of the 19 saved
 * models in the dev database as well (4 recorded `'mse'`; 15 recorded
 * nothing). Nothing typechecked this, because the atom is `atom<string>` and
 * every string is assignable.
 *
 * The store CANNOT import `DEFAULT_LOSS_FUNCTION` — that would close a store
 * -> training-config cycle `model-pipeline.ts` already documents avoiding for
 * `defaultHyperparams` — so it inlines the literal. A test is the only place
 * the two can be held equal, and this is it. Deleting this block returns the
 * codebase to the state that produced the defect.
 */
describe('MODEL-FLOW-019-T37: the loss default is a value the control offers', () => {
  const optionValues = LOSS_OPTIONS.map(o => o.value)

  it('DEFAULT_LOSS_FUNCTION is a member of LOSS_OPTIONS', () => {
    expect(optionValues).toContain(DEFAULT_LOSS_FUNCTION)
  })

  it("the store's inlined atom default equals DEFAULT_LOSS_FUNCTION", () => {
    // Read through a real store, so this pins the value the wizard actually
    // starts on rather than re-reading the constant under a second name.
    expect(createStore().get(mpLossFunctionAtom)).toBe(DEFAULT_LOSS_FUNCTION)
  })

  it('resetWizardAtom leaves a loss value the control can render', () => {
    const store = createStore()
    store.set(mpLossFunctionAtom, 'mae')
    store.set(resetWizardAtom)
    expect(optionValues).toContain(store.get(mpLossFunctionAtom))
    expect(store.get(mpLossFunctionAtom)).toBe(DEFAULT_LOSS_FUNCTION)
  })

  it('agrees with the metric vocabulary the rest of the system ranks on', () => {
    // LOSS_OPTIONS mirrors RankMetricKey (r2/rmse/mae) deliberately; 'mse'
    // sits outside it, which is why normalising rather than adding a fourth
    // option was the resolution. DEFAULT_RANK_METRIC is the same choice
    // MODEL-FLOW-005 made after a real run scored r2 = -1,110,858.
    expect(DEFAULT_LOSS_FUNCTION).toBe(DEFAULT_RANK_METRIC)
    expect([...optionValues].sort()).toEqual(['mae', 'r2', 'rmse'])
  })
})

describe('normaliseLossFunction', () => {
  it('passes an offered value through unchanged', () => {
    for (const { value } of LOSS_OPTIONS) {
      expect(normaliseLossFunction(value)).toBe(value)
    }
  })

  it("maps the legacy 'mse' to 'rmse' rather than defaulting it away", () => {
    // A RENAME, not a substitution: the two are monotonically related, so
    // they induce the same ordering, and the field never reaches the trainer.
    // Asserted as its own case so a future blanket fallback cannot quietly
    // absorb it — the mapping is a decision, and it is recorded as one.
    expect(normaliseLossFunction('mse')).toBe('rmse')
  })

  it('resolves absent and empty to the default', () => {
    expect(normaliseLossFunction(undefined)).toBe(DEFAULT_LOSS_FUNCTION)
    expect(normaliseLossFunction(null)).toBe(DEFAULT_LOSS_FUNCTION)
    expect(normaliseLossFunction('')).toBe(DEFAULT_LOSS_FUNCTION)
  })

  it('resolves an unrecognised value to the default rather than passing it on', () => {
    expect(normaliseLossFunction('cross_entropy')).toBe(DEFAULT_LOSS_FUNCTION)
    expect(normaliseLossFunction('huber')).toBe(DEFAULT_LOSS_FUNCTION)
  })

  it('ALWAYS returns something LOSS_OPTIONS can render — the whole point', () => {
    const inputs = [undefined, null, '', 'mse', 'rmse', 'mae', 'r2', 'nonsense']
    for (const input of inputs) {
      expect(optionValuesOf()).toContain(normaliseLossFunction(input))
    }
  })
})

function optionValuesOf() {
  return LOSS_OPTIONS.map(o => o.value)
}
