import { describe, it, expect } from 'vitest'
import { residualSdOf, type ResidualSdRun } from './residual-sd'
import type { RunPredictionsBatchItem } from '@/services/model-draft'

function run(overrides: Partial<ResidualSdRun> = {}): ResidualSdRun {
  return {
    status: 'SUCCEEDED',
    cvFoldsKey: null,
    predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    scoringContainerId: null,
    ...overrides,
  }
}

function item(
  overrides: Partial<RunPredictionsBatchItem> = {},
): RunPredictionsBatchItem {
  return {
    runId: 'run-1',
    sourceKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    rowCount: 100,
    residualSd: 0.42,
    residualRmseCheck: 0.5,
    yTrueMin: 0,
    yTrueMax: 10,
    yPredMin: 0,
    yPredMax: 10,
    points: [],
    downsampled: false,
    error: null,
    ...overrides,
  }
}

describe('residualSdOf — a non-terminal row has no reason to report', () => {
  it('reads no source and no absence for a run that never launched or is still running', () => {
    expect(residualSdOf(run({ status: 'PENDING' }), undefined, false)).toEqual({
      value: null,
      source: null,
      absence: null,
    })
    expect(residualSdOf(run({ status: 'RUNNING' }), undefined, false)).toEqual({
      value: null,
      source: null,
      absence: null,
    })
  })
})

describe('residualSdOf — a CV run not yet scored', () => {
  it('resolves to holdout — where its figure lands once scored — with "awaiting-scoring"', () => {
    const cvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: null,
      scoringContainerId: null,
    })
    expect(residualSdOf(cvRun, undefined, false)).toEqual({
      value: null,
      source: 'holdout',
      absence: 'awaiting-scoring',
    })
  })

  it('reads "scoring" while a scoring container is in flight', () => {
    const cvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: null,
      scoringContainerId: 'container-1',
    })
    expect(residualSdOf(cvRun, undefined, false)).toEqual({
      value: null,
      source: 'holdout',
      absence: 'scoring',
    })
  })
})

describe('residualSdOf — the three distinguishable null causes on a fetchable run (V12)', () => {
  it('reads "no-series" for a non-CV run predating the predictions endpoint', () => {
    const legacyRun = run({ predictionsKey: null })
    expect(residualSdOf(legacyRun, undefined, false)).toEqual({
      value: null,
      source: 'test-split',
      absence: 'no-series',
    })
  })

  it('reads "unreadable" — carrying the error — when the batch item itself failed', () => {
    const result = residualSdOf(
      run(),
      item({ residualSd: null, error: 'NoSuchKey' }),
      false,
    )
    expect(result.absence).toBe('unreadable')
    expect(result.errorText).toBe('NoSuchKey')
  })

  it('reads "not-recorded" when the key exists but the batch has nothing to say about it', () => {
    expect(residualSdOf(run(), undefined, false)).toEqual({
      value: null,
      source: 'test-split',
      absence: 'not-recorded',
    })
  })

  it('the three causes above are pairwise distinct', () => {
    const noSeries = residualSdOf(
      run({ predictionsKey: null }),
      undefined,
      false,
    )
    const unreadable = residualSdOf(
      run(),
      item({ residualSd: null, error: 'NoSuchKey' }),
      false,
    )
    const notRecorded = residualSdOf(run(), undefined, false)
    const causes = [noSeries.absence, unreadable.absence, notRecorded.absence]
    expect(new Set(causes).size).toBe(3)
  })

  it('reports no reason at all while the batch is still in flight', () => {
    expect(residualSdOf(run(), undefined, true)).toEqual({
      value: null,
      source: 'test-split',
      absence: null,
    })
  })
})

describe('residualSdOf — population differs by run shape (V11)', () => {
  it('reads test-split for an ordinary non-CV run', () => {
    const result = residualSdOf(run(), item({ residualSd: 0.3 }), false)
    expect(result).toEqual({ value: 0.3, source: 'test-split', absence: null })
  })

  it('reads holdout for a SCORED CV run — its predictions.parquet IS the holdout', () => {
    const scoredCvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    })
    const result = residualSdOf(scoredCvRun, item({ residualSd: 0.28 }), false)
    expect(result).toEqual({ value: 0.28, source: 'holdout', absence: null })
  })

  it('a non-CV run and a scored CV run resolve to different populations', () => {
    const nonCv = residualSdOf(run(), item({ residualSd: 0.3 }), false)
    const scoredCv = residualSdOf(
      run({ cvFoldsKey: 'cv_folds.json' }),
      item({ residualSd: 0.28 }),
      false,
    )
    expect(nonCv.source).not.toBe(scoredCv.source)
  })
})
