import { describe, it, expect } from 'vitest'
import {
  computeMetrics,
  generateAnalysis,
  type EvalPoint,
} from './model-evaluation'
import type { AIModel } from '@/types'

function pt(predicted: number, actual: number): EvalPoint {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    predicted,
    actual,
    residual: predicted - actual,
  }
}

const MODEL: AIModel = {
  id: 'm1',
  workspaceId: 'w1',
  name: 'Pump A',
  data: { deployStatus: 'running', prodStatus: 'normal', logs: [] },
  nodesId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: null,
}

describe('computeMetrics', () => {
  it('computes RMSE / MAE / bias / R² from known values', () => {
    // predicted=[2,4], actual=[1,2] → errors [1,2]
    const m = computeMetrics([pt(2, 1), pt(4, 2)])
    expect(m.n).toBe(2)
    expect(m.mae).toBe(1.5)
    expect(m.bias).toBe(1.5)
    expect(m.rmse).toBeCloseTo(1.58, 2)
    // SS_res=5, SS_tot=0.5 → R²=1-10=-9 (worse than mean)
    expect(m.r2).toBe(-9)
  })

  it('returns zeros for an empty set', () => {
    expect(computeMetrics([])).toEqual({
      rmse: 0,
      mae: 0,
      r2: 0,
      bias: 0,
      n: 0,
    })
  })
})

describe('generateAnalysis', () => {
  it('returns all three populated sections for real data', () => {
    const points = Array.from({ length: 20 }, (_, i) =>
      pt(10 + i - 0.8, 10 + i),
    )
    const analysis = generateAnalysis(MODEL, computeMetrics(points), points)
    expect(analysis.graphExplanation.length).toBeGreaterThan(0)
    expect(analysis.rootCause.length).toBeGreaterThanOrEqual(1)
    expect(analysis.rootCause.length).toBeLessThanOrEqual(3)
    expect(analysis.suggestions.length).toBeGreaterThanOrEqual(1)
    expect(analysis.suggestions.length).toBeLessThanOrEqual(3)
  })

  it('handles the empty case gracefully', () => {
    const analysis = generateAnalysis(MODEL, computeMetrics([]), [])
    expect(analysis.graphExplanation).toContain('No paired')
    expect(analysis.rootCause.length).toBe(1)
    expect(analysis.suggestions.length).toBe(1)
  })
})
