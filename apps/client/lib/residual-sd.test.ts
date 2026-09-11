import { describe, it, expect } from 'vitest'
import { residualSdOf, type ResidualSdRun } from './residual-sd'
import type { RunPredictionsBatchItem } from '@/services/model-draft'

/**
 * MODEL-FLOW-019-T33 swept every call here to pass an explicit POPULATION.
 * The argument is required rather than defaulted precisely so this sweep had
 * to happen: a default would have left each case silently asserting whichever
 * population the old derivation produced, which is the mis-captioning the
 * argument exists to prevent.
 */
function run(overrides: Partial<ResidualSdRun> = {}): ResidualSdRun {
  return {
    status: 'SUCCEEDED',
    algorithm: 'ridge',
    cvFoldsKey: null,
    predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    holdoutPredictionsKey: 'drafts/draft-1/runs/run-1/holdout.parquet',
    scoringContainerId: null,
    holdoutAbsence: null,
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
    expect(
      residualSdOf(run({ status: 'PENDING' }), undefined, false, 'test-split'),
    ).toEqual({ value: null, source: null, absence: null })
    expect(
      residualSdOf(run({ status: 'RUNNING' }), undefined, false, 'test-split'),
    ).toEqual({ value: null, source: null, absence: null })
  })
})

describe('residualSdOf — a CV run not yet scored', () => {
  it('resolves to holdout — where its figure lands once scored — with "awaiting-scoring"', () => {
    const cvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: null,
      scoringContainerId: null,
    })
    expect(residualSdOf(cvRun, undefined, false, 'holdout')).toEqual({
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
    expect(residualSdOf(cvRun, undefined, false, 'holdout')).toEqual({
      value: null,
      source: 'holdout',
      absence: 'scoring',
    })
  })
})

describe('residualSdOf — the three distinguishable null causes on a fetchable run (V12)', () => {
  it('reads "no-series" for a non-CV run predating the predictions endpoint', () => {
    const legacyRun = run({ predictionsKey: null })
    expect(residualSdOf(legacyRun, undefined, false, 'test-split')).toEqual({
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
      'test-split',
    )
    expect(result.absence).toBe('unreadable')
    expect(result.errorText).toBe('NoSuchKey')
  })

  it('reads "not-recorded" when the key exists but the batch has nothing to say about it', () => {
    expect(residualSdOf(run(), undefined, false, 'test-split')).toEqual({
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
      'test-split',
    )
    const unreadable = residualSdOf(
      run(),
      item({ residualSd: null, error: 'NoSuchKey' }),
      false,
      'test-split',
    )
    const notRecorded = residualSdOf(run(), undefined, false, 'test-split')
    const causes = [noSeries.absence, unreadable.absence, notRecorded.absence]
    expect(new Set(causes).size).toBe(3)
  })

  it('reports no reason at all while the batch is still in flight', () => {
    expect(residualSdOf(run(), undefined, true, 'test-split')).toEqual({
      value: null,
      source: 'test-split',
      absence: null,
    })
  })
})

describe('residualSdOf — population is the ARGUMENT, not a derivation (V11, T33)', () => {
  it('reads test-split for an ordinary non-CV run', () => {
    const result = residualSdOf(
      run(),
      item({ residualSd: 0.3 }),
      false,
      'test-split',
    )
    expect(result).toEqual({ value: 0.3, source: 'test-split', absence: null })
  })

  it('reads holdout for a SCORED CV run — its predictions.parquet IS the holdout', () => {
    const scoredCvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    })
    const result = residualSdOf(
      scoredCvRun,
      item({ residualSd: 0.28 }),
      false,
      'holdout',
    )
    expect(result).toEqual({ value: 0.28, source: 'holdout', absence: null })
  })

  /**
   * THE REGRESSION THIS ARGUMENT EXISTS TO PREVENT. The old derivation
   * returned `test-split` UNCONDITIONALLY for a non-CV run, so a holdout SD
   * read through it captioned as Test — a real number under the wrong column
   * heading, which is the single failure this whole feature exists to stop.
   */
  it('captions a non-CV run holdout SD as holdout, never as test-split', () => {
    const result = residualSdOf(
      run(),
      item({ residualSd: 0.31 }),
      false,
      'holdout',
    )
    expect(result).toEqual({ value: 0.31, source: 'holdout', absence: null })
  })

  it('reads one run twice and gets two populations from the same shape', () => {
    const r = run()
    const test = residualSdOf(r, item({ residualSd: 0.3 }), false, 'test-split')
    const validate = residualSdOf(
      r,
      item({ residualSd: 0.36 }),
      false,
      'holdout',
    )
    expect(test.source).toBe('test-split')
    expect(validate.source).toBe('holdout')
    expect(test.value).not.toBe(validate.value)
  })
})

/**
 * MODEL-FLOW-019-T33. The per-column absences, which could not exist while
 * one cell was routed to whichever column its own derived source named — the
 * other column rendered a bare dash and explained nothing, so a definitional
 * absence looked exactly like a fixable one.
 */
describe('residualSdOf — each column names its OWN absence', () => {
  it('a CV run has no test split by definition, and says so', () => {
    const cvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    })
    expect(residualSdOf(cvRun, undefined, false, 'test-split')).toEqual({
      value: null,
      source: 'test-split',
      absence: 'no-test-split',
    })
  })

  it("a non-CV run with no holdout series borrows T29's own verdict, not a new one", () => {
    // No `holdoutPredictionsKey`, nothing in flight, and a holdout score that
    // exists — so the SERIES is what is missing: `aggregate-only`.
    const noSeries = run({ holdoutPredictionsKey: null })
    expect(residualSdOf(noSeries, undefined, false, 'holdout')).toEqual({
      value: null,
      source: 'holdout',
      absence: 'aggregate-only',
    })
  })

  it('names a dataset with no holdout at all, which no button can fix', () => {
    const noHoldout = run({
      holdoutPredictionsKey: null,
      holdoutAbsence: 'no-dataset-holdout',
    })
    expect(residualSdOf(noHoldout, undefined, false, 'holdout')).toEqual({
      value: null,
      source: 'holdout',
      absence: 'no-dataset-holdout',
    })
  })

  it('names a sequence model as terminal rather than offering scoring that skips it', () => {
    const lstm = run({ algorithm: 'lstm', holdoutPredictionsKey: null })
    expect(residualSdOf(lstm, undefined, false, 'holdout')).toEqual({
      value: null,
      source: 'holdout',
      absence: 'sequence-not-scoreable',
    })
  })

  it('the Test and Validate absences on ONE run differ, and neither is a bare null', () => {
    const cvRun = run({
      cvFoldsKey: 'cv_folds.json',
      predictionsKey: 'drafts/draft-1/runs/run-1/predictions.parquet',
    })
    const test = residualSdOf(cvRun, undefined, false, 'test-split')
    const validate = residualSdOf(
      cvRun,
      item({ residualSd: 0.28 }),
      false,
      'holdout',
    )
    expect(test.absence).toBe('no-test-split')
    expect(validate.absence).toBeNull()
    expect(validate.value).toBe(0.28)
  })
})
