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
  type HoldoutAbsence,
  groupAbsenceText,
  groupOmittedText,
  holdoutSeriesAbsenceOf,
  scoreableRunIds,
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
    // MODEL-FLOW-019-T20. A non-CV run with no figure on a CONFIRMED
    // holdout-bearing dataset is ALSO not-scored-yet now, not not-recorded
    // — scoring is triggerable for any SUCCEEDED run, so this is always
    // actionable rather than a bare defect claim.
    expect(holdoutAbsenceOf(run(), true)).toBe('not-scored-yet')
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

  // MODEL-FLOW-019-V26. A phase outside `CvScoringPhase`'s four members is
  // a TYPE ERROR at the call site, caught by `tsc --noEmit`, not a runtime
  // default `populationOf`'s own switch could silently fall through to —
  // the `never` exhaustiveness check inside it (module doc) is what a
  // widened parameter type would defeat. An unused `@ts-expect-error`
  // directive is itself a type error, so this fails loudly the moment the
  // guard weakens (e.g. the parameter loosened to `string`) rather than
  // staying silently green.
  it('rejects a phase outside CvScoringPhase at compile time (V26)', () => {
    // @ts-expect-error — 'rescoring' is not a member of CvScoringPhase, so
    // this call fails to typecheck TODAY. If `CvScoringPhase` is ever
    // widened to a fifth real phase, or `populationOf`'s parameter is
    // loosened (e.g. to `string`), this call stops erroring and the
    // directive itself becomes an "unused @ts-expect-error" error under
    // `tsc --noEmit` — a build failure, not a silently green test.
    populationOf('rescoring')
    expect(true).toBe(true)
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

/**
 * MODEL-FLOW-019-T20 follow-up. The two chart-level absence statements.
 *
 * These exist because the overlay chart used to render `null` when it had
 * no series — which is what a real draft always hit, since no run in the
 * database has ever been scored against a holdout. A reader saw one chart
 * and could not tell "not applicable" from "not scored yet" from "broken".
 */
describe('groupAbsenceText', () => {
  const cv = { cvFoldsKey: 'k', holdoutSeriesAbsence: null }
  const nonCv = { cvFoldsKey: null, holdoutSeriesAbsence: null }

  it('tells an all-CV group its test split does not exist, rather than calling it missing', () => {
    const text = groupAbsenceText('test-split', [cv, cv])
    expect(text).toMatch(/cross-validated/i)
    expect(text).not.toMatch(/missing|failed/i)
  })

  it('does not claim "no test split" when even one candidate is not cross-validated', () => {
    expect(groupAbsenceText('test-split', [cv, nonCv])).not.toMatch(
      /cross-validated run has no test split/i,
    )
  })

  it('reports a dataset with no holdout as a dataset fact, not a scoring gap', () => {
    const text = groupAbsenceText('holdout', [
      { cvFoldsKey: null, holdoutSeriesAbsence: 'no-dataset-holdout' },
      { cvFoldsKey: null, holdoutSeriesAbsence: 'no-dataset-holdout' },
    ])
    expect(text).toMatch(/dataset has no validation holdout/i)
    expect(text).not.toMatch(/yet/i)
  })

  it('reports an unscored holdout as actionable, never as a defect', () => {
    const text = groupAbsenceText('holdout', [
      { cvFoldsKey: null, holdoutSeriesAbsence: 'not-scored-yet' },
    ])
    expect(text).toMatch(/scored against the validation holdout yet/i)
  })

  // MODEL-FLOW-019-T20 follow-up. The state 188 of 252 SUCCEEDED runs are
  // actually in, live-counted 2026-09-09: a holdout SCORE exists, no
  // per-row SERIES does. This is the sentence the original bug report was
  // about — the panel fell through to the generic "nothing recorded" text
  // for exactly this case.
  it('names the score-exists-but-no-series state, not a generic absence', () => {
    const text = groupAbsenceText('holdout', [
      { cvFoldsKey: null, holdoutSeriesAbsence: 'aggregate-only' },
    ])
    expect(text).toMatch(/validation-holdout score/i)
    expect(text).toMatch(/no per-row series/i)
    expect(text).not.toMatch(/no candidate recorded a/i)
  })

  it('reports in-flight scoring rather than any other absence, when mixed', () => {
    const text = groupAbsenceText('holdout', [
      { cvFoldsKey: null, holdoutSeriesAbsence: 'scoring' },
      { cvFoldsKey: null, holdoutSeriesAbsence: 'aggregate-only' },
    ])
    expect(text).toMatch(/scoring is in progress/i)
  })

  it('prioritises the aggregate-only state over a mixed no-dataset-holdout reading', () => {
    const text = groupAbsenceText('holdout', [
      { cvFoldsKey: null, holdoutSeriesAbsence: 'no-dataset-holdout' },
      { cvFoldsKey: null, holdoutSeriesAbsence: 'aggregate-only' },
    ])
    expect(text).toMatch(/validation-holdout score/i)
  })

  it('never returns an empty string, for any population or group', () => {
    for (const p of ['test-split', 'holdout'] as const) {
      for (const g of [[], [cv], [nonCv], [cv, nonCv]]) {
        expect(groupAbsenceText(p, g).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('holdoutSeriesAbsenceOf', () => {
  const base = {
    status: 'SUCCEEDED',
    cvFoldsKey: null as string | null,
    predictionsKey: null as string | null,
    holdoutPredictionsKey: null as string | null,
    scoringContainerId: null as string | null,
    holdoutAbsence: null as HoldoutAbsence | null,
  }

  it('is null (nothing to explain) once a non-CV run has its own holdout series', () => {
    expect(
      holdoutSeriesAbsenceOf({ ...base, holdoutPredictionsKey: 'k' }),
    ).toBeNull()
  })

  it("is null once a CV run's predictionsKey carries its holdout series", () => {
    expect(
      holdoutSeriesAbsenceOf({
        ...base,
        cvFoldsKey: 'cv',
        predictionsKey: 'k',
      }),
    ).toBeNull()
  })

  it("does not mistake a non-CV run's OWN test-split predictionsKey for a holdout series", () => {
    // The exact conflation MODEL-FLOW-019 exists to prevent, restated at
    // the series layer: a non-CV run's `predictionsKey` is its test split,
    // never its holdout — only `holdoutPredictionsKey` counts here.
    expect(
      holdoutSeriesAbsenceOf({ ...base, predictionsKey: 'test-split-key' }),
    ).not.toBeNull()
  })

  it('is "scoring" while a container is in flight, even with an aggregate already present', () => {
    expect(
      holdoutSeriesAbsenceOf({
        ...base,
        scoringContainerId: 'c1',
        holdoutAbsence: null,
      }),
    ).toBe('scoring')
  })

  it('is "aggregate-only" for the 188-run majority: a score exists, no series does', () => {
    expect(holdoutSeriesAbsenceOf({ ...base, holdoutAbsence: null })).toBe(
      'aggregate-only',
    )
  })

  it('is "not-scored-yet" when neither a figure nor a series exists', () => {
    expect(
      holdoutSeriesAbsenceOf({ ...base, holdoutAbsence: 'not-scored-yet' }),
    ).toBe('not-scored-yet')
  })

  it('is "no-dataset-holdout" only when the dataset fact is confirmed absent', () => {
    expect(
      holdoutSeriesAbsenceOf({
        ...base,
        holdoutAbsence: 'no-dataset-holdout',
      }),
    ).toBe('no-dataset-holdout')
  })

  it('is null for a run that has not SUCCEEDED — nothing to explain yet', () => {
    expect(holdoutSeriesAbsenceOf({ ...base, status: 'RUNNING' })).toBeNull()
  })
})

describe('scoreableRunIds', () => {
  const base = {
    runId: 'r1',
    status: 'SUCCEEDED',
    cvFoldsKey: null as string | null,
    predictionsKey: null as string | null,
    holdoutPredictionsKey: null as string | null,
    scoringContainerId: null as string | null,
    holdoutAbsence: null as HoldoutAbsence | null,
  }

  it('includes an aggregate-only candidate — the actual majority case', () => {
    expect(scoreableRunIds([base])).toEqual(['r1'])
  })

  it('excludes a candidate already scoring, so a click cannot double-spawn', () => {
    expect(scoreableRunIds([{ ...base, scoringContainerId: 'c1' }])).toEqual([])
  })

  it('excludes a confirmed no-dataset-holdout candidate — scoring would 400', () => {
    expect(
      scoreableRunIds([{ ...base, holdoutAbsence: 'no-dataset-holdout' }]),
    ).toEqual([])
  })

  it('excludes a candidate that already has its series', () => {
    expect(scoreableRunIds([{ ...base, holdoutPredictionsKey: 'k' }])).toEqual(
      [],
    )
  })

  it('excludes a candidate with no runId', () => {
    expect(scoreableRunIds([{ ...base, runId: null }])).toEqual([])
  })
})

describe('groupOmittedText', () => {
  it('says nothing when every candidate was drawn', () => {
    expect(
      groupOmittedText(new Set(['a', 'b']), [
        { runId: 'a', label: 'OLS' },
        { runId: 'b', label: 'Random Forest' },
      ]),
    ).toBeUndefined()
  })

  it('names the candidates a partial chart left out', () => {
    const text = groupOmittedText(new Set(['a']), [
      { runId: 'a', label: 'OLS' },
      { runId: 'b', label: 'Random Forest' },
    ])
    expect(text).toContain('Random Forest')
    expect(text).not.toContain('OLS')
  })

  it('counts a candidate with no runId as omitted, not as drawn', () => {
    expect(
      groupOmittedText(new Set(['a']), [
        { runId: 'a', label: 'OLS' },
        { runId: null, label: 'MLP' },
      ]),
    ).toContain('MLP')
  })
})
