import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import type { Algorithm } from '@/store/model-pipeline'
import {
  CONSUMED_HYPERPARAM_KEYS,
  SEED_CONSUMING_ALGORITHMS,
  seedConsumedBy,
  classifyHyperparams,
  splitPercentFromRun,
  toApplyPatch,
} from './run-params'

/**
 * MODEL-FLOW-012-V05. A static source guard, not a hand-copied table: reads
 * `images/trainer/train.py` itself and extracts exactly the keys each
 * `build_model` branch reads via `hyperparameters.get("KEY", ...)`. If a UI
 * knob is added to `HYPERPARAMS` (lib/training-config.ts) without a matching
 * `.get()` in the trainer, or `build_model`'s per-algorithm reads drift,
 * this fails — a hand-typed key list would keep passing while the panel
 * silently claimed a value took effect that the estimator never saw.
 */
const TRAINER_FILE = path.resolve(__dirname, '../../../images/trainer/train.py')

function readTrainer(): string {
  return readFileSync(TRAINER_FILE, 'utf-8')
}

function extractBuildModelBody(source: string): string {
  const start = source.indexOf('def build_model(')
  if (start === -1) {
    throw new Error(
      'build_model not found in train.py — has it moved or been renamed?',
    )
  }
  const rest = source.slice(start)
  const nextDef = rest.indexOf('\ndef ', 1)
  return nextDef === -1 ? rest : rest.slice(0, nextDef)
}

const HEADER_TO_ALGORITHM: { pattern: RegExp; algorithm: Algorithm }[] = [
  {
    pattern: /if algorithm in \("hgb", "hist_gradient_boosting"\):/,
    algorithm: 'hist_gradient_boosting',
  },
  { pattern: /if algorithm == "ridge":/, algorithm: 'ridge' },
  { pattern: /if algorithm == "ols":/, algorithm: 'ols' },
  { pattern: /if algorithm == "svm":/, algorithm: 'svm' },
  { pattern: /if algorithm == "mlp":/, algorithm: 'mlp' },
  { pattern: /if algorithm == "grp":/, algorithm: 'grp' },
  { pattern: /if algorithm == "pls":/, algorithm: 'pls' },
  { pattern: /if algorithm == "random_forest":/, algorithm: 'random_forest' },
  { pattern: /if algorithm == "lightgbm":/, algorithm: 'lightgbm' },
  { pattern: /if algorithm == "xgboost":/, algorithm: 'xgboost' },
]

function extractConsumedKeys(
  body: string,
): Partial<Record<Algorithm, string[]>> {
  const headers = HEADER_TO_ALGORITHM.map(({ pattern, algorithm }) => {
    const match = pattern.exec(body)
    if (!match) {
      throw new Error(
        `train.py no longer has a build_model branch matching ${pattern} ` +
          `(expected for "${algorithm}") — CONSUMED_HYPERPARAM_KEYS is stale.`,
      )
    }
    return { algorithm, index: match.index }
  }).sort((a, b) => a.index - b.index)

  const result: Partial<Record<Algorithm, string[]>> = {}
  headers.forEach(({ algorithm, index }, i) => {
    const next = headers[i + 1]
    const end = next ? next.index : body.length
    const block = body.slice(index, end)
    const keys = [...block.matchAll(/hyperparameters\.get\(\s*"([^"]+)"/g)]
      .map(m => m[1])
      .filter((k): k is string => k !== undefined)
    result[algorithm] = [...new Set(keys)]
  })
  return result
}

describe('CONSUMED_HYPERPARAM_KEYS matches images/trainer/train.py, read live', () => {
  const body = extractBuildModelBody(readTrainer())
  const actual = extractConsumedKeys(body)

  for (const algorithm of Object.keys(
    CONSUMED_HYPERPARAM_KEYS,
  ) as Algorithm[]) {
    if (algorithm === 'lstm' || algorithm === 'gru') continue
    it(`${algorithm}: the catalogue's consumed-key list equals what build_model actually reads`, () => {
      expect([...(actual[algorithm] ?? [])].sort()).toEqual(
        [...CONSUMED_HYPERPARAM_KEYS[algorithm]].sort(),
      )
    })
  }

  it('lstm/gru raise before any hyperparameters.get() call — nothing is consumed', () => {
    expect(body).toMatch(
      /if algorithm in \("lstm", "gru"\):[\s\S]*?raise RuntimeError/,
    )
    expect(CONSUMED_HYPERPARAM_KEYS.lstm).toEqual([])
    expect(CONSUMED_HYPERPARAM_KEYS.gru).toEqual([])
  })
})

describe('seedConsumedBy', () => {
  it('matches the six estimators train.py forwards random_state to', () => {
    expect([...SEED_CONSUMING_ALGORITHMS].sort()).toEqual(
      [
        'hist_gradient_boosting',
        'mlp',
        'grp',
        'random_forest',
        'lightgbm',
        'xgboost',
      ].sort(),
    )
  })

  it('is false for ridge/ols/svm/pls — train.py never passes random_state to them', () => {
    expect(seedConsumedBy('ridge')).toBe(false)
    expect(seedConsumedBy('ols')).toBe(false)
    expect(seedConsumedBy('svm')).toBe(false)
    expect(seedConsumedBy('pls')).toBe(false)
  })

  it('is true for an estimator that does receive random_state', () => {
    expect(seedConsumedBy('random_forest')).toBe(true)
  })
})

describe('classifyHyperparams', () => {
  it('labels a key build_model does not read for that algorithm as unconsumed', () => {
    const rows = classifyHyperparams('random_forest', {
      n_estimators: 100,
      max_depth: null,
      min_samples_leaf: 5,
    })
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.consumed]))
    expect(byKey.n_estimators).toBe(true)
    expect(byKey.max_depth).toBe(true)
    expect(byKey.min_samples_leaf).toBe(false)
  })

  it('falls back to the raw key when no catalogue label exists', () => {
    const rows = classifyHyperparams('ols', { some_future_key: 1 })
    expect(rows[0]?.label).toBe('some_future_key')
  })

  it('returns [] for null/undefined hyperparameters', () => {
    expect(classifyHyperparams('ols', null)).toEqual([])
    expect(classifyHyperparams('ols', undefined)).toEqual([])
  })
})

describe('splitPercentFromRun', () => {
  it('converts the persisted fraction to the percentage the Step 3 control uses', () => {
    expect(splitPercentFromRun({ method: 'chronological', ratio: 0.8 })).toBe(
      80,
    )
    expect(splitPercentFromRun({ method: 'chronological', ratio: 0.7 })).toBe(
      70,
    )
  })
})

describe('toApplyPatch', () => {
  it('keeps scalar values, including a null nullable-number, untouched', () => {
    const { hyperparameters, dropped } = toApplyPatch({
      hyperparameters: {
        alpha: 0.037,
        fit_intercept: true,
        kernel: 'rbf',
        max_depth: null,
      },
    })
    expect(hyperparameters).toEqual({
      alpha: 0.037,
      fit_intercept: true,
      kernel: 'rbf',
      max_depth: null,
    })
    expect(dropped).toEqual([])
  })

  it('drops a non-scalar value and names it, rather than letting the PATCH 400', () => {
    const { hyperparameters, dropped } = toApplyPatch({
      hyperparameters: { alpha: 1, weird: { nested: true } },
    })
    expect(hyperparameters).toEqual({ alpha: 1 })
    expect(dropped).toEqual(['weird'])
  })
})
