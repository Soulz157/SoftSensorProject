import { describe, it, expect } from 'vitest'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import {
  defaultFineTuneRunId,
  fineTuneChoicesFor,
  fineTuneBaseFor,
  fineTuneBlockReason,
  type FineTuneContext,
} from './fine-tune'

function run(over: Record<string, unknown>): ModelTrainingRunListItem {
  return {
    id: 'r',
    algorithm: 'random_forest',
    status: 'SUCCEEDED',
    createdAt: '2026-01-01T00:00:00Z',
    targetY: 'TI-101',
    hyperparameters: { n_estimators: 100 },
    metrics: { r2: 0.9, rmse: 2, mae: 1 },
    holdoutMetrics: null,
    cvFoldsKey: null,
    predictionsKey: null,
    scoringContainerId: null,
    splitSpec: { method: 'time_ordered', ratio: 0.8 },
    ...over,
  } as unknown as ModelTrainingRunListItem
}

const CTX: FineTuneContext = {
  targetY: 'TI-101',
  trainTestSplit: 80,
  nSplits: undefined,
  dirty: false,
  training: false,
}

describe('defaultFineTuneRunId', () => {
  const runs = [
    run({ id: 'a', metrics: { rmse: 3, mae: 1 }, createdAt: '2026-01-02' }),
    run({ id: 'b', metrics: { rmse: 2, mae: 2 }, createdAt: '2026-01-01' }),
    run({ id: 'c', status: 'FAILED', metrics: null }),
  ]

  it('opens on the best SUCCEEDED run by the ranking metric', () => {
    expect(defaultFineTuneRunId(runs, 'rmse')).toBe('b')
    expect(defaultFineTuneRunId(runs, 'mae')).toBe('a')
  })

  it('is null while nothing has succeeded', () => {
    expect(defaultFineTuneRunId([runs[2]!], 'rmse')).toBeNull()
    expect(defaultFineTuneRunId([], 'rmse')).toBeNull()
  })
})

describe('fineTuneBaseFor', () => {
  it("lays the run's values over the algorithm's full defaults", () => {
    const base = fineTuneBaseFor(
      'random_forest',
      run({ hyperparameters: { n_estimators: 300 } }),
    )
    expect(base.n_estimators).toBe(300)
    // A key the run did not record comes from the defaults, so the preview and
    // the server judge a full record.
    expect(Object.keys(base).length).toBeGreaterThan(1)
  })

  it('drops a non-scalar value rather than sending it', () => {
    const base = fineTuneBaseFor(
      'random_forest',
      run({ hyperparameters: { n_estimators: 300, weird: { nested: true } } }),
    )
    expect(base).not.toHaveProperty('weird')
  })
})

describe('fineTuneBlockReason', () => {
  it('lets a matching, applied, idle run through', () => {
    expect(fineTuneBlockReason(run({}), CTX)).toBeNull()
  })

  it('asks for a run when none is picked', () => {
    expect(fineTuneBlockReason(null, CTX)).toMatch(/Pick a run/)
  })

  it('refuses while training or with unapplied edits', () => {
    expect(fineTuneBlockReason(run({}), { ...CTX, training: true })).toMatch(
      /in progress/,
    )
    expect(fineTuneBlockReason(run({}), { ...CTX, dirty: true })).toMatch(
      /Apply or discard/,
    )
  })

  it('refuses a run for another target', () => {
    expect(fineTuneBlockReason(run({ targetY: 'TI-999' }), CTX)).toMatch(
      /TI-999/,
    )
    expect(
      fineTuneBlockReason(run({}), { ...CTX, targetY: null }),
    ).not.toBeNull()
  })

  it('refuses a different train/test ratio, not a different mode', () => {
    expect(
      fineTuneBlockReason(run({}), { ...CTX, trainTestSplit: 70 }),
    ).toMatch(/80\/20 split, but 70\/30/)
    // CV on while the run used a ratio: a chosen mix, allowed.
    expect(
      fineTuneBlockReason(run({}), {
        ...CTX,
        trainTestSplit: 70,
        nSplits: 5,
      }),
    ).toBeNull()
  })

  it('refuses a different k for a CV run, allows a ratio split over it', () => {
    const cv = run({
      cvFoldsKey: 'cv/folds.json',
      metrics: { n_splits: 5 },
      splitSpec: { method: 'cv_expanding', n_splits: 5 },
    })
    expect(fineTuneBlockReason(cv, { ...CTX, nSplits: 3 })).toMatch(
      /5-fold.*3 folds/,
    )
    expect(fineTuneBlockReason(cv, { ...CTX, nSplits: 5 })).toBeNull()
    expect(fineTuneBlockReason(cv, CTX)).toBeNull()
  })
})

describe('fineTuneChoicesFor', () => {
  it('one card per algorithm, its best run, best algorithm first', () => {
    const runs = [
      run({
        id: 'r1',
        algorithm: 'ridge',
        metrics: { rmse: 3 },
        createdAt: '2026-01-01',
      }),
      run({
        id: 'r2',
        algorithm: 'ridge',
        metrics: { rmse: 1.5 },
        createdAt: '2026-01-02',
      }),
      run({ id: 'x1', algorithm: 'xgboost', metrics: { rmse: 2 } }),
      run({ id: 'f', algorithm: 'svm', status: 'FAILED', metrics: null }),
    ]
    const choices = fineTuneChoicesFor(runs, 'rmse')
    expect(choices.map(c => [c.algorithm, c.run.id, c.runCount])).toEqual([
      ['ridge', 'r2', 2],
      ['xgboost', 'x1', 1],
    ])
  })

  it('orders by the ranking metric in force', () => {
    const runs = [
      run({ id: 'a', algorithm: 'ridge', metrics: { rmse: 1, mae: 3 } }),
      run({ id: 'b', algorithm: 'ols', metrics: { rmse: 2, mae: 1 } }),
    ]
    expect(fineTuneChoicesFor(runs, 'mae').map(c => c.algorithm)).toEqual([
      'ols',
      'ridge',
    ])
  })
})
