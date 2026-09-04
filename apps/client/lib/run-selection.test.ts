import { describe, it, expect } from 'vitest'
import {
  renderModeFor,
  modeARows,
  modeAHasValidationSeries,
  modeAMetricLabel,
  modeBMarks,
} from './run-selection'
import type { CandidateResult } from '@/services/model-draft'

function candidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    runId: 'run-1',
    algorithm: 'ols',
    hyperparameters: {},
    phase: 1,
    status: 'SUCCEEDED',
    failureReason: null,
    metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
    trainMetrics: { r2: 0.95, rmse: 0.3, mae: 0.2 },
    lossHistoryKey: null,
    lossHistory: null,
    predictionsKey: null,
    cvFoldsKey: null,
    scoringContainerId: null,
    ...overrides,
  }
}

describe('renderModeFor', () => {
  it('is mode A whenever a run has a real lossHistory, regardless of algorithm', () => {
    const c = candidate({
      algorithm: 'ols', // a closed-form algorithm — the point is this never matters
      lossHistoryKey: 'drafts/d/runs/r/loss_history.json',
      lossHistory: {
        algorithm: 'ols',
        metric: 'loss',
        series: { train: [1, 0.5] },
      },
    })
    expect(renderModeFor(c)).toBe('A')
  })

  it('is mode B whenever lossHistory is null, regardless of algorithm', () => {
    const c = candidate({ algorithm: 'xgboost', lossHistory: null })
    expect(renderModeFor(c)).toBe('B')
  })
})

describe('modeARows', () => {
  it('returns [] for a mode-B candidate rather than throwing', () => {
    expect(modeARows(candidate({ lossHistory: null }))).toEqual([])
  })

  it('pairs train/validation by index, 1-based iteration', () => {
    const c = candidate({
      lossHistory: {
        algorithm: 'xgboost',
        metric: 'rmse',
        series: { train: [1.0, 0.5, 0.3], validation: [1.1, 0.6, 0.4] },
      },
    })
    expect(modeARows(c)).toEqual([
      { iteration: 1, train: 1.0, validation: 1.1 },
      { iteration: 2, train: 0.5, validation: 0.6 },
      { iteration: 3, train: 0.3, validation: 0.4 },
    ])
  })

  it('leaves validation null for every row when the series has none (mlp)', () => {
    const c = candidate({
      lossHistory: {
        algorithm: 'mlp',
        metric: 'loss',
        series: { train: [0.9, 0.5] },
      },
    })
    expect(modeARows(c)).toEqual([
      { iteration: 1, train: 0.9, validation: null },
      { iteration: 2, train: 0.5, validation: null },
    ])
  })
})

describe('modeAHasValidationSeries', () => {
  it('is false for mlp (train-only) and true for lightgbm/xgboost', () => {
    expect(
      modeAHasValidationSeries(
        candidate({
          lossHistory: {
            algorithm: 'mlp',
            metric: 'loss',
            series: { train: [1] },
          },
        }),
      ),
    ).toBe(false)
    expect(
      modeAHasValidationSeries(
        candidate({
          lossHistory: {
            algorithm: 'lightgbm',
            metric: 'rmse',
            series: { train: [1], validation: [1.1] },
          },
        }),
      ),
    ).toBe(true)
  })
})

describe('modeAMetricLabel', () => {
  it('is RMSE only when the run itself recorded that metric', () => {
    expect(
      modeAMetricLabel(
        candidate({
          lossHistory: {
            algorithm: 'xgboost',
            metric: 'rmse',
            series: { train: [1] },
          },
        }),
      ),
    ).toBe('RMSE')
  })

  it('is Loss for the native-units algorithms — never assumed comparable to RMSE', () => {
    expect(
      modeAMetricLabel(
        candidate({
          lossHistory: {
            algorithm: 'hist_gradient_boosting',
            metric: 'loss',
            series: { train: [1] },
          },
        }),
      ),
    ).toBe('Loss')
  })
})

describe('modeBMarks', () => {
  it('returns exactly two paired marks, train then test, never a line series', () => {
    const c = candidate({
      trainMetrics: { r2: 0.95, rmse: 0.3, mae: 0.2 },
      metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
    })
    expect(modeBMarks(c)).toEqual([
      { label: 'Train', rmse: 0.3 },
      { label: 'Test', rmse: 0.5 },
    ])
  })

  it('is null, not fabricated, when a metric is missing (e.g. a FAILED candidate)', () => {
    const c = candidate({ trainMetrics: null, metrics: null })
    expect(modeBMarks(c)).toEqual([
      { label: 'Train', rmse: null },
      { label: 'Test', rmse: null },
    ])
  })
})
