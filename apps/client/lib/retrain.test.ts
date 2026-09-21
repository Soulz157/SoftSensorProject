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
    ...overrides,
  }
}

const METRICS = { rmse: 1, r2: 0.9, mae: 0.5 }

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
    },
    incumbent: {
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      algorithm: 'xgboost',
      metrics: METRICS,
    },
    candidate: {
      runId: 'run-1',
      versionId: null,
      version: null,
      stage: null,
      algorithm: 'xgboost',
      metrics: { rmse: 0.5, r2: 0.95, mae: 0.3 },
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

  it('is evaluating once at least one candidate has completed but the job is still live', () => {
    expect(retrainPhase(job({ status: 'RUNNING', completedRuns: 1 }))).toBe(
      'evaluating',
    )
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
