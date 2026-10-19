import { describe, it, expect } from 'vitest'
import type { Algorithm } from '@/store/model-pipeline'
import {
  MAX_LAUNCH_CANDIDATES,
  candidatesFor,
  planFineTuneLaunch,
  planTrainingLaunch,
  type HyperparamRecord,
  type LaunchInput,
} from './training-launch'

const BASES: Partial<Record<Algorithm, HyperparamRecord>> = {
  random_forest: { n_estimators: 100, max_depth: null },
  xgboost: { learning_rate: 0.1, n_estimators: 200 },
  lstm: { sequence_length: 24, units: 32 },
}

function input(over: Partial<LaunchInput>): LaunchInput {
  return {
    algorithms: ['random_forest'],
    baseFor: a => BASES[a] ?? {},
    nSplits: undefined,
    ...over,
  }
}

describe('planTrainingLaunch — Round 1, card values only (MODEL-FLOW-035)', () => {
  it('one algorithm is a single run', () => {
    expect(planTrainingLaunch(input({}))).toEqual({
      type: 'single',
      candidate: {
        algorithm: 'random_forest',
        hyperparameters: BASES.random_forest,
      },
    })
  })

  it('one algorithm with Cross-Validation is still a single run', () => {
    expect(planTrainingLaunch(input({ nSplits: 5 })).type).toBe('single')
  })

  it('two algorithms train once each, in one ALGORITHM_SWEEP, never tuned', () => {
    const plan = planTrainingLaunch(
      input({ algorithms: ['random_forest', 'xgboost'] }),
    )
    expect(plan).toEqual({
      type: 'job',
      kind: 'ALGORITHM_SWEEP',
      candidates: [
        { algorithm: 'random_forest', hyperparameters: BASES.random_forest },
        { algorithm: 'xgboost', hyperparameters: BASES.xgboost },
      ],
    })
  })

  it('refuses CV with two algorithms', () => {
    expect(() =>
      planTrainingLaunch(
        input({ algorithms: ['random_forest', 'xgboost'], nSplits: 5 }),
      ),
    ).toThrow(/Cross-Validation fits one algorithm/)
  })

  it('refuses a sequence model beside another algorithm', () => {
    expect(() =>
      planTrainingLaunch(input({ algorithms: ['random_forest', 'lstm'] })),
    ).toThrow(/trains on its own/)
  })

  it('refuses an empty selection', () => {
    expect(() => planTrainingLaunch(input({ algorithms: [] }))).toThrow(
      /Select an algorithm/,
    )
  })
})

describe('planFineTuneLaunch — Round 2 (MODEL-FLOW-035)', () => {
  const base = BASES.random_forest!

  it('curated variants on: the base alone, the server expands the grid', () => {
    expect(
      planFineTuneLaunch({
        algorithm: 'random_forest',
        base,
        rows: [],
        useGrid: true,
      }),
    ).toEqual({
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [{ algorithm: 'random_forest', hyperparameters: base }],
    })
  })

  it('curated variants on: added rows travel as extraVariants, after the grid', () => {
    const plan = planFineTuneLaunch({
      algorithm: 'random_forest',
      base,
      rows: [{ n_estimators: 300 }],
      useGrid: true,
    })
    expect(plan.candidates).toHaveLength(1)
    expect(plan.extraVariants).toEqual([{ n_estimators: 300 }])
  })

  it('curated variants off: the base and the rows are the candidates', () => {
    const plan = planFineTuneLaunch({
      algorithm: 'random_forest',
      base,
      rows: [{ n_estimators: 300 }],
      useGrid: false,
    })
    expect(plan).toEqual({
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [
        { algorithm: 'random_forest', hyperparameters: base },
        {
          algorithm: 'random_forest',
          hyperparameters: { n_estimators: 300, max_depth: null },
        },
      ],
    })
    expect(plan.extraVariants).toBeUndefined()
  })

  it('curated variants off with nothing to try is refused, not a repeat of the run', () => {
    for (const rows of [[], [{ n_estimators: 100 }]]) {
      expect(() =>
        planFineTuneLaunch({
          algorithm: 'random_forest',
          base,
          rows,
          useGrid: false,
        }),
      ).toThrow(/Add a variant/)
    }
  })

  it(`refuses more than ${MAX_LAUNCH_CANDIDATES} candidates before sending`, () => {
    const rows = Array.from({ length: MAX_LAUNCH_CANDIDATES }, (_, i) => ({
      n_estimators: 200 + i,
    }))
    expect(() =>
      planFineTuneLaunch({
        algorithm: 'random_forest',
        base,
        rows,
        useGrid: false,
      }),
    ).toThrow(/more than the 20/)
  })

  it('tunes a sequence model on its own (one algorithm)', () => {
    const plan = planFineTuneLaunch({
      algorithm: 'lstm',
      base: BASES.lstm!,
      rows: [{ units: 64, sequence_length: 48 }],
      useGrid: false,
    })
    expect(plan.candidates[1]?.hyperparameters).toEqual({
      sequence_length: 24,
      units: 64,
    })
  })
})

describe('candidatesFor', () => {
  it('drops a row equal to the card, or to an earlier row', () => {
    const got = candidatesFor('random_forest', BASES.random_forest!, [
      { n_estimators: 100 },
      { n_estimators: 300 },
      { n_estimators: 300, max_depth: null },
    ])
    expect(got.map(c => c.hyperparameters.n_estimators)).toEqual([100, 300])
  })

  it("keeps a sequence model's window length from the card", () => {
    const got = candidatesFor('lstm', BASES.lstm!, [
      { sequence_length: 48, units: 64 },
    ])
    expect(got[1]?.hyperparameters).toEqual({ sequence_length: 24, units: 64 })
  })
})
