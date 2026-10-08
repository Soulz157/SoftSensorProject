import { describe, expect, it } from 'vitest'
import type { RetrainComparison, RetrainJob } from '@/services/model-retrain'
import {
  comparisonView,
  newIdempotencyKey,
  retrainPhase,
  stageBoxState,
} from './retrain'

function job(overrides: Partial<RetrainJob> = {}): RetrainJob {
  return {
    id: 'job-1',
    modelId: 'model-1',
    sourceVersionId: 'version-1',
    resultVersionId: null,
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: 0.8,
    kind: 'HYPERPARAMETER_SEARCH',
    totalRuns: 4,
    completedRuns: 0,
    status: 'QUEUED',
    failureReason: null,
    currentRunId: 'run-1',
    bestRunId: null,
    bestRmse: null,
    selectedRunId: null,
    idempotencyKey: null,
    createdAt: '2026-09-01T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    candidates: [],
    comparison: null,
    retrainStrategy: null,
    baseDatasetVersionId: null,
    additionalDatasetVersionId: null,
    combinedArtifactId: null,
    cvFolds: null,
    acceptanceCriteria: null,
    ...overrides,
  }
}

const METRICS = { rmse: 1, r2: 0.9, mae: 0.5 }
const INCUMBENT_BASIS = {
  frame: 'INCUMBENT_TEST_SPLIT' as const,
  from: null,
  to: null,
  rowCount: null,
  usedFor: 'COMPARE_TO_PRODUCTION' as const,
  unavailableReason: 'not recorded',
}

function comparison(
  overrides: Partial<RetrainComparison> = {},
): RetrainComparison {
  return {
    basis: {
      goldArtifactId: 'gold-1',
      artifactChecksum: 'sha-1',
      targetY: 'TI-101',
      split: { method: 'chronological', ratio: 0.8 },
      comparable: true,
      reason: null,
      strategy: 'KEEP_EXISTING',
      evalSet: null,
      trainingComposition: null,
    },
    incumbent: {
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      algorithm: 'xgboost',
      sourceRunId: 'run-incumbent',
      metrics: METRICS,
      metricsBasis: INCUMBENT_BASIS,
    },
    candidate: {
      runId: 'run-1',
      versionId: null,
      version: null,
      stage: null,
      algorithm: 'xgboost',
      metrics: { rmse: 0.5, r2: 0.95, mae: 0.3 },
      metricsBasis: null,
      newRegimeMetrics: null,
      newRegimeMetricsBasis: null,
      newDataHoldoutMetrics: null,
      newDataHoldoutRowCount: null,
      newDataHoldoutFrom: null,
      newDataHoldoutTo: null,
      newDataHoldoutBasis: null,
    },
    rmseDelta: -0.5,
    selectionMetric: 'rmse',
    ...overrides,
  }
}

describe('retrainPhase', () => {
  it('is idle with no job', () => {
    expect(retrainPhase(null)).toBe('idle')
  })

  it('is training while queued/running with no completed candidates', () => {
    expect(retrainPhase(job({ status: 'QUEUED', completedRuns: 0 }))).toBe(
      'training',
    )
    expect(retrainPhase(job({ status: 'RUNNING', completedRuns: 0 }))).toBe(
      'training',
    )
  })

  it('is validating once some — not all — candidates have completed (MODEL-SERVE-027)', () => {
    expect(retrainPhase(job({ status: 'RUNNING', completedRuns: 1 }))).toBe(
      'validating',
    )
    expect(retrainPhase(job({ status: 'RUNNING', completedRuns: 3 }))).toBe(
      'validating',
    )
  })

  it('is evaluating (Result) once every candidate has completed and the job is still live', () => {
    expect(retrainPhase(job({ status: 'RUNNING', completedRuns: 4 }))).toBe(
      'evaluating',
    )
  })

  it('walks all three boxes in order: each becomes active before it is done', () => {
    const seen = [0, 1, 4].map(n =>
      (['training', 'validating', 'evaluating'] as const).map(k =>
        stageBoxState(
          k,
          retrainPhase(job({ status: 'RUNNING', completedRuns: n })),
        ),
      ),
    )
    expect(seen).toEqual([
      ['active', 'pending', 'pending'],
      ['done', 'active', 'pending'],
      ['done', 'done', 'active'],
    ])
  })

  it('is done on SUCCEEDED', () => {
    expect(retrainPhase(job({ status: 'SUCCEEDED' }))).toBe('done')
  })

  it('is error on FAILED or CANCELED', () => {
    expect(retrainPhase(job({ status: 'FAILED' }))).toBe('error')
    expect(retrainPhase(job({ status: 'CANCELED' }))).toBe('error')
  })
})

describe('stageBoxState', () => {
  it('marks every stage done once the job is done', () => {
    expect(stageBoxState('training', 'done')).toBe('done')
    expect(stageBoxState('evaluating', 'done')).toBe('done')
  })

  it('marks pending stages beyond the current one as pending', () => {
    expect(stageBoxState('evaluating', 'training')).toBe('pending')
  })

  it('marks the current stage active and earlier stages done', () => {
    expect(stageBoxState('training', 'evaluating')).toBe('done')
    expect(stageBoxState('evaluating', 'evaluating')).toBe('active')
  })

  it('marks every stage pending on idle or error', () => {
    expect(stageBoxState('training', 'idle')).toBe('pending')
    expect(stageBoxState('training', 'error')).toBe('pending')
  })
})

describe('comparisonView', () => {
  it('is null with no comparison', () => {
    expect(comparisonView(null)).toBeNull()
  })

  it('surfaces the rmseDelta when the basis is comparable', () => {
    const view = comparisonView(comparison())
    expect(view).toEqual({
      comparable: true,
      reason: null,
      incumbentMetrics: METRICS,
      candidateMetrics: { rmse: 0.5, r2: 0.95, mae: 0.3 },
      rmseDelta: -0.5,
      strategy: 'KEEP_EXISTING',
      evalSet: null,
      newRegimeMetrics: null,
      newDataHoldoutMetrics: null,
      newDataHoldoutRowCount: null,
      newDataHoldoutFrom: null,
      newDataHoldoutTo: null,
      incumbentMetricsBasis: INCUMBENT_BASIS,
      candidateMetricsBasis: null,
      newRegimeMetricsBasis: null,
      newDataHoldoutBasis: null,
      trainingComposition: null,
    })
  })

  it('drops the delta and keeps both raw metric triples when not comparable', () => {
    const view = comparisonView(
      comparison({
        basis: {
          goldArtifactId: 'gold-1',
          artifactChecksum: 'sha-1',
          targetY: 'TI-101',
          split: { method: 'chronological', ratio: 0.8 },
          comparable: false,
          reason: 'different training artifact',
          strategy: 'KEEP_EXISTING',
          evalSet: null,
          trainingComposition: null,
        },
        rmseDelta: null,
      }),
    )
    expect(view?.comparable).toBe(false)
    expect(view?.reason).toBe('different training artifact')
    expect(view?.rmseDelta).toBeNull()
    expect(view?.incumbentMetrics).toEqual(METRICS)
    expect(view?.candidateMetrics).toEqual({ rmse: 0.5, r2: 0.95, mae: 0.3 })
  })
})

describe('newIdempotencyKey', () => {
  it('returns a non-empty string, different on each call', () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })
})
