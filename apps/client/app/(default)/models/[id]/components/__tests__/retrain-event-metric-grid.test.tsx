import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComparisonView } from '@/lib/retrain'
import type { EvalBasis } from '@/services/model-retrain'
import type { RunPredictions } from '@/services/model-draft'

// Candidate: 18 held rows of 100 predicted exactly, then 2 held rows of 110
// predicted 100 — the miss is diluted over all rows, not at lab events.
// Current: every row predicted 105 — 5 off everywhere.
const Y = [...Array(18).fill(100), ...Array(2).fill(110)] as number[]
const series = (pred: (y: number) => number): RunPredictions => ({
  sourceKey: 'k',
  rowCount: Y.length,
  residualSd: 0,
  residualRmseCheck: 0,
  yTrueMin: 100,
  yTrueMax: 110,
  yPredMin: 100,
  yPredMax: 110,
  points: Y.map((y, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
    yTrue: y,
    yPred: pred(y),
  })),
  derivedFromTarget: null,
  targetScaled: null,
})

vi.mock('@/services/model-retrain', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/model-retrain')>()
  return {
    ...actual,
    modelRunPredictionsService: {
      get: vi.fn(async (_m: string, _r: string, population: string) => ({
        statusCode: 200,
        message: 'ok',
        type: 'SUCCESS' as const,
        data:
          population === 'current_new_data_holdout'
            ? series(() => 105)
            : series(() => 100),
      })),
    },
  }
})

import { RetrainEventMetricGrid } from '../retrain-event-metric-grid'

const windowBasis: EvalBasis = {
  frame: 'NEW_DATA_WINDOW',
  from: '2026-01-01',
  to: '2026-01-01',
  rowCount: 20,
  usedFor: 'COMPARE_TO_PRODUCTION',
  unavailableReason: null,
}

const view = (comparable: boolean): ComparisonView => ({
  comparable,
  reason: null,
  // The SERVER's all-row figures — what the grid must keep, labelled.
  candidateMetrics: { rmse: 3.1623, r2: 0.1, mae: 1 },
  incumbentMetrics: { rmse: 5, r2: -0.2, mae: 5 },
  rmseDelta: -1.8377,
  strategy: 'NEW_DATA_ONLY',
  evalSet: null,
  newRegimeMetrics: null,
  newDataHoldoutMetrics: null,
  newDataHoldoutRowCount: null,
  newDataHoldoutFrom: null,
  newDataHoldoutTo: null,
  incumbentMetricsBasis: windowBasis,
  candidateMetricsBasis: windowBasis,
  newRegimeMetricsBasis: null,
  newDataHoldoutBasis: null,
  trainingComposition: null,
})

describe('RetrainEventMetricGrid (MODEL-SERVE-026-T03)', () => {
  it('leads with the lab-event figure, keeps the all-row figure labelled, and scores BOTH versions by the same rule', async () => {
    render(
      <RetrainEventMetricGrid
        view={view(true)}
        currentVersion={1}
        ids={{
          modelId: 'm-a',
          candidateRunId: 'cand',
          incumbentSourceRunId: 'inc',
        }}
      />,
    )
    // Candidate RMSE at 2 lab events: sqrt((0 + 100) / 2) = 7.0711 — NOT the
    // server's diluted 3.1623, which stays beneath it as "all rows".
    expect(await screen.findByText('7.0711')).toBeInTheDocument()
    expect(screen.getAllByText('at 2 lab events')).toHaveLength(3)
    expect(screen.getByText('all rows 3.1623')).toBeInTheDocument()
    // RMSE and MAE are both 5 for a constant 5-off prediction: two cells.
    expect(
      screen.getAllByText('current v1 5.0000 at lab events · 5.0000 all rows'),
    ).toHaveLength(2)
    // The headline flips: all rows said improved; at lab events it regressed.
    expect(
      screen.getByText(/At lab events, RMSE regressed by/),
    ).toBeInTheDocument()
    expect(screen.getByText('2.0711')).toBeInTheDocument()
  })

  it('shows no lab-event delta when the server did not call the two comparable', async () => {
    render(
      <RetrainEventMetricGrid
        view={view(false)}
        currentVersion={1}
        ids={{
          modelId: 'm-b',
          candidateRunId: 'cand',
          incumbentSourceRunId: 'inc',
        }}
      />,
    )
    expect(await screen.findByText('7.0711')).toBeInTheDocument()
    expect(screen.queryByText(/At lab events, RMSE/)).toBeNull()
  })
})
