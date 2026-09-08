import { describe, it, expect } from 'vitest'
import {
  METRIC_SOURCE_LABELS,
  cvScoringPhaseOf,
  headlineMetricOf,
  holdoutAbsenceOf,
  populationAxisLabel,
  populationLabel,
  populationOf,
  populationTitle,
  rmseOf,
  sourcedMetricsOf,
  type MetricSource,
  type MetricSourceRun,
} from './metric-source'

/**
 * MODEL-FLOW-019-T02. Every fixture below is the SHAPE a real row has, not
 * an invented one: the holdout blob's keys (`row_count`,
 * `dropped_unlabelled`, `dropped_bad_features`) and the CV blob's
 * (`cv_rmse_mean`/`cv_rmse_std`/`n_splits`, with no bare `rmse`) were read
 * off real rows during T01's audit.
 */
function run(overrides: Partial<MetricSourceRun & { status: string }> = {}) {
  return {
    status: 'SUCCEEDED',
    metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 } as Record<string, unknown> | null,
    holdoutMetrics: null as Record<string, unknown> | null,
    cvFoldsKey: null as string | null,
    predictionsKey: 'drafts/d/runs/r/predictions.parquet' as string | null,
    scoringContainerId: null as string | null,
    ...overrides,
  }
}

const REAL_HOLDOUT = {
  r2: -2.5595085122232173,
  mae: 0.1431604564833554,
  rmse: 0.16871918983885217,
  row_count: 1153,
  dropped_unlabelled: 0,
  dropped_bad_features: 0,
}

const REAL_CV_METRICS = {
  cv_r2_mean: 0.42,
  cv_r2_std: 0.05,
  cv_rmse_mean: 0.21203298,
  cv_rmse_std: 0.01706996,
  cv_mae_mean: 0.17,
  cv_mae_std: 0.01,
  n_splits: 3,
  refit_rows: 8512,
  feature_count: 12,
}

describe('sourcedMetricsOf', () => {
  it('tags an ordinary run test-split', () => {
    expect(sourcedMetricsOf(run())).toEqual([
      { source: 'test-split', r2: 0.9, rmse: 0.5, mae: 0.4 },
    ])
  })

  it('carries the holdout counts WITH the holdout figure, never beside it', () => {
    const sourced = sourcedMetricsOf(run({ holdoutMetrics: REAL_HOLDOUT }))
    expect(sourced).toHaveLength(2)
    expect(sourced[1]).toEqual({
      source: 'holdout',
      r2: REAL_HOLDOUT.r2,
      rmse: REAL_HOLDOUT.rmse,
      mae: REAL_HOLDOUT.mae,
      rowCount: 1153,
      droppedUnlabelled: 0,
      droppedBadFeatures: 0,
    })
  })

  it('records absent holdout counts as null rather than as zero dropped rows', () => {
    // A run scored before those keys existed: it has the figure and not the
    // counts. Reading that as "0 dropped" would assert a clean holdout that
    // was never measured — MODEL-FLOW-010-T06's honest-legacy-null pattern.
    const [, holdout] = sourcedMetricsOf(
      run({ holdoutMetrics: { r2: 0.8, rmse: 0.2, mae: 0.1 } }),
    )
    expect(holdout).toMatchObject({
      source: 'holdout',
      rowCount: null,
      droppedUnlabelled: null,
      droppedBadFeatures: null,
    })
  })

  it('gives a CV run a fold estimate with its spread, and NO rmse field to misread', () => {
    const sourced = sourcedMetricsOf(
      run({ metrics: REAL_CV_METRICS, cvFoldsKey: 'k', predictionsKey: null }),
    )
    expect(sourced).toEqual([
      {
        source: 'cv-fold-estimate',
        nSplits: 3,
        mean: { r2: 0.42, rmse: 0.21203298, mae: 0.17 },
        std: { r2: 0.05, rmse: 0.01706996, mae: 0.01 },
      },
    ])
    // The tag is what stops a reader treating the fold mean as a measurement.
    expect(sourced[0]).not.toHaveProperty('rmse')
  })

  it('gives a CV run no test-split entry even though `metrics` is non-null', () => {
    const sourced = sourcedMetricsOf(
      run({ metrics: REAL_CV_METRICS, cvFoldsKey: 'k', predictionsKey: null }),
    )
    expect(sourced.some(m => m.source === 'test-split')).toBe(false)
  })

  it('emits both sources for a scored CV run, fold estimate first', () => {
    const sourced = sourcedMetricsOf(
      run({
        metrics: REAL_CV_METRICS,
        cvFoldsKey: 'k',
        holdoutMetrics: REAL_HOLDOUT,
      }),
    )
    expect(sourced.map(m => m.source)).toEqual(['cv-fold-estimate', 'holdout'])
  })

  it('drops a non-numeric or non-finite value rather than passing it through', () => {
    const [testSplit] = sourcedMetricsOf(
      run({ metrics: { r2: '0.9', rmse: Number.NaN, mae: 0.4 } }),
    )
    expect(testSplit).toEqual({
      source: 'test-split',
      r2: null,
      rmse: null,
      mae: 0.4,
    })
  })

  it('returns nothing for a run that produced nothing', () => {
    expect(sourcedMetricsOf(run({ metrics: null }))).toEqual([])
    expect(sourcedMetricsOf(null)).toEqual([])
  })
})

describe('holdoutAbsenceOf', () => {
  it('says nothing when a figure is present', () => {
    expect(
      holdoutAbsenceOf(run({ holdoutMetrics: REAL_HOLDOUT }), true),
    ).toBeNull()
  })

  it('distinguishes all three absent-holdout facts', () => {
    // The dataset never had one — the common case, not an error.
    expect(holdoutAbsenceOf(run(), false)).toBe('no-dataset-holdout')
    // A CV run that has not been through its own scoring phase.
    expect(
      holdoutAbsenceOf(run({ cvFoldsKey: 'k', predictionsKey: null }), true),
    ).toBe('not-scored-yet')
    // The dataset HAS one and this run still carries no figure: trained
    // before the 2026-09-01 replay fix, or a replay that failed.
    expect(holdoutAbsenceOf(run(), true)).toBe('not-recorded')
  })

  it('reads an unknown dataset-level answer as not-recorded, never as a guess', () => {
    expect(holdoutAbsenceOf(run(), null)).toBe('not-recorded')
  })

  it('says nothing about a run that has not succeeded', () => {
    expect(holdoutAbsenceOf(run({ status: 'RUNNING' }), false)).toBeNull()
    expect(holdoutAbsenceOf(run({ status: 'FAILED' }), false)).toBeNull()
  })
})

describe('cvScoringPhaseOf', () => {
  it('reads the four phases off the three raw signals', () => {
    expect(cvScoringPhaseOf(run())).toBe('not-cv')
    expect(
      cvScoringPhaseOf(run({ cvFoldsKey: 'k', predictionsKey: null })),
    ).toBe('awaiting-scoring')
    expect(
      cvScoringPhaseOf(
        run({
          cvFoldsKey: 'k',
          predictionsKey: null,
          scoringContainerId: 'c1',
        }),
      ),
    ).toBe('scoring')
    expect(cvScoringPhaseOf(run({ cvFoldsKey: 'k' }))).toBe('scored')
    expect(cvScoringPhaseOf(null)).toBe('not-cv')
  })
})

describe('headlineMetricOf and rmseOf', () => {
  it('leads with the holdout — the only number no fit ever saw', () => {
    const sourced = sourcedMetricsOf(run({ holdoutMetrics: REAL_HOLDOUT }))
    expect(headlineMetricOf(sourced)?.source).toBe('holdout')
  })

  it("falls back to the run's own training-side figure", () => {
    expect(headlineMetricOf(sourcedMetricsOf(run()))?.source).toBe('test-split')
    expect(headlineMetricOf([])).toBeNull()
  })

  it('reads a fold estimate rmse from the MEAN, since it has no other', () => {
    const [cv] = sourcedMetricsOf(
      run({ metrics: REAL_CV_METRICS, cvFoldsKey: 'k', predictionsKey: null }),
    )
    expect(rmseOf(cv!)).toBe(0.21203298)
  })
})

describe('METRIC_SOURCE_LABELS', () => {
  it('names each source the way the shipped Step 4 column already does', () => {
    expect(`${METRIC_SOURCE_LABELS['test-split']} RMSE`).toBe('Test RMSE')
    // 'Validate', not 'Holdout' — the word Step 4's own column header uses.
    // MODEL-FLOW-019-T15 deliberately does NOT resolve Holdout-vs-Validate;
    // it centralises the choice so it stays one line here, whichever way
    // MODEL-FLOW-021's open decision lands.
    expect(`${METRIC_SOURCE_LABELS.holdout} RMSE`).toBe('Validate RMSE')
    expect(`${METRIC_SOURCE_LABELS['cv-fold-estimate']} RMSE`).toBe(
      'Est. CV RMSE',
    )
  })
})

/**
 * MODEL-FLOW-019-T15. The population a predictions file describes, derived
 * from `MetricSource` rather than declared beside it. These assert the
 * SHAPE — every phase resolves, the two run kinds differ — never the
 * contested word, which is still an open decision.
 */
describe('populationOf — exhaustive over all four scoring phases', () => {
  it('reads the test split for an ordinary run and the holdout for a scored CV run', () => {
    expect(populationOf('not-cv')).toBe('test-split')
    expect(populationOf('scored')).toBe('holdout')
    // The two run kinds must not collapse to one label.
    expect(populationOf('not-cv')).not.toBe(populationOf('scored'))
  })

  it('never names a test split for a CV run that has none, in either pre-scoring phase', () => {
    expect(populationOf('awaiting-scoring')).toBe('holdout')
    expect(populationOf('scoring')).toBe('holdout')
  })

  it('is a member of MetricSource, never a second spelling of one', () => {
    const sources: MetricSource[] = [
      'test-split',
      'holdout',
      'cv-fold-estimate',
    ]
    expect(sources).toContain(populationOf('not-cv'))
    expect(sources).toContain(populationOf('scored'))
  })
})

describe('population label forms', () => {
  it('gives an axis form in the same vocabulary as the Step 4 columns', () => {
    expect(populationAxisLabel('test-split')).toBe(
      METRIC_SOURCE_LABELS['test-split'],
    )
    expect(populationAxisLabel('holdout')).toBe(METRIC_SOURCE_LABELS.holdout)
  })

  it('gives a prose form and a heading form that differ from each other and by population', () => {
    expect(populationLabel('test-split')).not.toBe(populationLabel('holdout'))
    expect(populationTitle('test-split')).not.toBe(populationTitle('holdout'))
    expect(populationTitle('holdout')).not.toBe(populationLabel('holdout'))
  })
})
