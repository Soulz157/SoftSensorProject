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

/**
 * MODEL-FLOW-014-T07. `main()`'s `is_sequence` branch (train.py:818-839),
 * where `sequence_length` is actually consumed — ONE LEVEL UP from
 * `build_model`, before it is ever called (see `CONSUMED_HYPERPARAM_KEYS`'s
 * own doc comment for why this needs its own extraction rather than being
 * silently absent from a build_model-only scan).
 */
function extractSequenceBranchBody(source: string): string {
  const start = source.indexOf('if is_sequence:')
  if (start === -1) {
    throw new Error(
      'main()\'s "if is_sequence:" branch not found in train.py — has it ' +
        "moved or been renamed? CONSUMED_HYPERPARAM_KEYS.lstm/gru's " +
        'sequence_length entry can no longer be verified.',
    )
  }
  const rest = source.slice(start)
  const elseIdx = rest.indexOf('\n    else:')
  return elseIdx === -1 ? rest : rest.slice(0, elseIdx)
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
  // lstm/gru share ONE branch (`if algorithm in ("lstm", "gru"):`) — handled
  // separately below rather than folded into this table, since one header
  // maps to TWO algorithms here, unlike every other row.
]

const LSTM_GRU_HEADER = /if algorithm in \("lstm", "gru"\):/

function headerIndices(
  buildModelBody: string,
): { algorithm: Algorithm; index: number }[] {
  const headers = HEADER_TO_ALGORITHM.map(({ pattern, algorithm }) => {
    const match = pattern.exec(buildModelBody)
    if (!match) {
      throw new Error(
        `train.py no longer has a build_model branch matching ${pattern} ` +
          `(expected for "${algorithm}") — CONSUMED_HYPERPARAM_KEYS is stale.`,
      )
    }
    return { algorithm, index: match.index }
  })

  const lstmMatch = LSTM_GRU_HEADER.exec(buildModelBody)
  if (!lstmMatch) {
    throw new Error(
      'train.py no longer has a build_model branch matching ' +
        `${LSTM_GRU_HEADER} — CONSUMED_HYPERPARAM_KEYS.lstm/gru is stale.`,
    )
  }
  headers.push(
    { algorithm: 'lstm', index: lstmMatch.index },
    { algorithm: 'gru', index: lstmMatch.index },
  )
  return headers.sort((a, b) => a.index - b.index)
}

function blockFor(
  buildModelBody: string,
  headers: { algorithm: Algorithm; index: number }[],
  index: number,
): string {
  const uniqueIndices = [...new Set(headers.map(h => h.index))].sort(
    (a, b) => a - b,
  )
  const nextIndex = uniqueIndices.find(i => i > index)
  return buildModelBody.slice(index, nextIndex ?? buildModelBody.length)
}

function extractConsumedKeys(
  buildModelBody: string,
  sequenceBranchBody: string,
): Partial<Record<Algorithm, string[]>> {
  const headers = headerIndices(buildModelBody)

  const result: Partial<Record<Algorithm, string[]>> = {}
  headers.forEach(({ algorithm, index }) => {
    const block = blockFor(buildModelBody, headers, index)
    const keys = [...block.matchAll(/hyperparameters\.get\(\s*"([^"]+)"/g)]
      .map(m => m[1])
      .filter((k): k is string => k !== undefined)
    result[algorithm] = [...new Set(keys)]
  })

  // sequence_length is consumed one level up, in main()'s is_sequence
  // branch — merge it in for lstm/gru specifically rather than leaving the
  // build_model-only scan conclude it is unconsumed.
  if (/\.get\(\s*\n?\s*"sequence_length"/.test(sequenceBranchBody)) {
    result.lstm = [...(result.lstm ?? []), 'sequence_length']
    result.gru = [...(result.gru ?? []), 'sequence_length']
  }

  return result
}

/**
 * MODEL-FLOW-014-T07 CORRECTION. The old assertion here regexed
 * `if algorithm in ("lstm", "gru"):[\s\S]*?raise RuntimeError` and
 * concluded lstm/gru consume nothing — a FALSE PASS. That regex matches
 * the `LSTM_MAX_TRAIN_WINDOWS` ceiling guard (a real refusal for an
 * oversized run, not an unconditional one), and by the time
 * MODEL-FLOW-009-T04 built the windowing pipeline, this branch reads
 * hidden_size/epochs/batch_size via hyperparameters.get() same as every
 * other algorithm. This suite now scans the branch live instead of
 * asserting a hand-typed conclusion about it.
 */
function extractSeedConsumingAlgorithms(
  buildModelBody: string,
): Set<Algorithm> {
  const headers = headerIndices(buildModelBody)

  const consuming = new Set<Algorithm>()
  headers.forEach(({ algorithm, index }) => {
    const block = blockFor(buildModelBody, headers, index)
    // Two spellings: sklearn/lightgbm/xgboost's `random_state=seed`, and
    // SequenceRegressor's own `seed=seed` — an extractor matching only the
    // first form would conclude lstm/gru don't consume it, the same false
    // pass this suite exists to stop making.
    if (
      /\brandom_state\s*=\s*seed\b/.test(block) ||
      /\bseed\s*=\s*seed\b/.test(block)
    ) {
      consuming.add(algorithm)
    }
  })
  return consuming
}

describe('CONSUMED_HYPERPARAM_KEYS matches images/trainer/train.py, read live', () => {
  const source = readTrainer()
  const buildModelBody = extractBuildModelBody(source)
  const sequenceBranchBody = extractSequenceBranchBody(source)
  const actual = extractConsumedKeys(buildModelBody, sequenceBranchBody)

  for (const algorithm of Object.keys(
    CONSUMED_HYPERPARAM_KEYS,
  ) as Algorithm[]) {
    it(`${algorithm}: the catalogue's consumed-key list equals what train.py actually reads`, () => {
      expect([...(actual[algorithm] ?? [])].sort()).toEqual(
        [...CONSUMED_HYPERPARAM_KEYS[algorithm]].sort(),
      )
    })
  }
})

describe('SEED_CONSUMING_ALGORITHMS matches images/trainer/train.py, read live', () => {
  const buildModelBody = extractBuildModelBody(readTrainer())
  const actual = extractSeedConsumingAlgorithms(buildModelBody)

  it('the catalogue equals what train.py actually forwards seed/random_state to', () => {
    expect([...SEED_CONSUMING_ALGORITHMS].sort()).toEqual([...actual].sort())
  })

  it('ridge explicitly drops random_state — a documented refusal, not merely an unmentioned field', () => {
    const headers = headerIndices(buildModelBody)
    const ridge = headers.find(h => h.algorithm === 'ridge')
    expect(ridge).toBeDefined()
    const ridgeBlock = blockFor(buildModelBody, headers, ridge!.index)
    expect(ridgeBlock).toMatch(/random_state dropped/)
    expect(actual.has('ridge')).toBe(false)
  })
})

describe('seedConsumedBy', () => {
  it('is false for ridge/ols/svm/pls — train.py never passes random_state to them', () => {
    expect(seedConsumedBy('ridge')).toBe(false)
    expect(seedConsumedBy('ols')).toBe(false)
    expect(seedConsumedBy('svm')).toBe(false)
    expect(seedConsumedBy('pls')).toBe(false)
  })

  it('is true for an estimator that receives random_state=seed', () => {
    expect(seedConsumedBy('random_forest')).toBe(true)
  })

  it('is true for lstm/gru, which receive seed=seed (a different spelling, same consumption)', () => {
    expect(seedConsumedBy('lstm')).toBe(true)
    expect(seedConsumedBy('gru')).toBe(true)
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
