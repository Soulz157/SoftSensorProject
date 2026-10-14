import { describe, it, expect } from 'vitest'
import type { Algorithm } from '@/store/model-pipeline'
import {
  MAX_LAUNCH_CANDIDATES,
  candidatesFor,
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
    extraVariants: {},
    findBestParams: false,
    nSplits: undefined,
    ...over,
  }
}

describe('planTrainingLaunch — Find Best Parameters off', () => {
  it('one algorithm and no rows is a single run', () => {
    expect(planTrainingLaunch(input({}))).toEqual({
      type: 'single',
      candidate: {
        algorithm: 'random_forest',
        hyperparameters: BASES.random_forest,
      },
    })
  })

  it('one algorithm with rows searches exactly those rows, with CV allowed', () => {
    const plan = planTrainingLaunch(
      input({
        extraVariants: { random_forest: [{ n_estimators: 300 }] },
        nSplits: 5,
      }),
    )
    expect(plan).toEqual({
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [
        { algorithm: 'random_forest', hyperparameters: BASES.random_forest },
        {
          algorithm: 'random_forest',
          hyperparameters: { n_estimators: 300, max_depth: null },
        },
      ],
    })
  })

  it('two algorithms train every candidate in one sweep', () => {
    const plan = planTrainingLaunch(
      input({
        algorithms: ['random_forest', 'xgboost'],
        extraVariants: { random_forest: [{ max_depth: 8 }] },
      }),
    )
    expect(plan.type).toBe('job')
    if (plan.type !== 'job') return
    expect(plan.kind).toBe('ALGORITHM_SWEEP')
    expect(plan.candidates.map(c => c.algorithm)).toEqual([
      'random_forest',
      'random_forest',
      'xgboost',
    ])
    expect(plan.extraVariants).toBeUndefined()
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
})

describe('planTrainingLaunch — Find Best Parameters on', () => {
  it('one algorithm keeps the server-side grid search, rows as extraVariants', () => {
    const rows = [{ n_estimators: 300 }]
    expect(
      planTrainingLaunch(
        input({ findBestParams: true, extraVariants: { random_forest: rows } }),
      ),
    ).toEqual({
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [
        { algorithm: 'random_forest', hyperparameters: BASES.random_forest },
      ],
      extraVariants: rows,
    })
  })

  it('two algorithms sweep every candidate, then tune the winner', () => {
    const plan = planTrainingLaunch(
      input({
        algorithms: ['random_forest', 'xgboost'],
        findBestParams: true,
        extraVariants: { xgboost: [{ learning_rate: 0.05 }] },
      }),
    )
    expect(plan.type === 'job' && plan.kind).toBe('SWEEP_THEN_TUNE')
    expect(plan.type === 'job' && plan.candidates).toHaveLength(3)
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

describe('the candidate cap', () => {
  it(`refuses more than ${MAX_LAUNCH_CANDIDATES} candidates before sending`, () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      n_estimators: 200 + i,
    }))
    expect(() =>
      planTrainingLaunch(
        input({
          algorithms: ['random_forest', 'xgboost', 'ridge'],
          extraVariants: {
            random_forest: rows,
            xgboost: rows.map(r => ({ learning_rate: r.n_estimators / 1000 })),
            ridge: rows.map(r => ({ alpha: r.n_estimators })),
          },
        }),
      ),
    ).toThrow(/more than the 20/)
  })
})
