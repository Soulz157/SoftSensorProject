import { describe, it, expect } from 'vitest'
import {
  computeMetrics,
  generateAnalysis,
  residualHistogram,
  normalQuantile,
  qqPoints,
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
  datasetId: null,
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

describe('residualHistogram', () => {
  it('returns empty for no residuals', () => {
    expect(residualHistogram([])).toEqual([])
  })

  it('bin counts sum to the sample size', () => {
    const residuals = [-3, -1, -1, 0, 0, 0, 1, 1, 2, 3]
    const bins = residualHistogram(residuals, 8)
    const total = bins.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(residuals.length)
  })

  it('collapses a degenerate (all-equal) input to one centred bin', () => {
    const bins = residualHistogram([2, 2, 2])
    expect(bins).toHaveLength(1)
    expect(bins[0]!.count).toBe(3)
    expect(bins[0]!.mid).toBe(2)
  })
})

describe('normalQuantile', () => {
  it('is ~0 at the median', () => {
    expect(Math.abs(normalQuantile(0.5))).toBeLessThan(1e-6)
  })

  it('matches known standard-normal quantiles', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 3)
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 3)
  })

  it('stays finite at the clamped endpoints', () => {
    expect(Number.isFinite(normalQuantile(0))).toBe(true)
    expect(Number.isFinite(normalQuantile(1))).toBe(true)
  })
})

describe('qqPoints', () => {
  it('returns one point per residual with a symmetric domain', () => {
    const residuals = Array.from({ length: 50 }, (_, i) => i - 24.5)
    const { points, domain } = qqPoints(residuals)
    expect(points).toHaveLength(50)
    expect(domain[0]).toBe(-domain[1])
  })

  it('produces sorted, centred standardized sample quantiles', () => {
    const residuals = Array.from({ length: 101 }, (_, i) => i - 50)
    const { points } = qqPoints(residuals)
    // Sample quantiles are the sorted standardized residuals → non-decreasing.
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.sample).toBeGreaterThanOrEqual(points[i - 1]!.sample)
    }
    // Symmetric input → the median standardized sample sits at ~0, and the
    // mid-range points hug the y = x diagonal (tails legitimately diverge for
    // non-normal data).
    const mid = points[Math.floor(points.length / 2)]!
    expect(Math.abs(mid.sample)).toBeLessThan(0.05)
    expect(Math.abs(mid.sample - mid.theoretical)).toBeLessThan(0.1)
  })

  it('handles the empty case', () => {
    expect(qqPoints([])).toEqual({ points: [], domain: [-3, 3] })
  })
})
