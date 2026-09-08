import { describe, it, expect } from 'vitest'
import {
  canRank,
  observationsPerFeature,
  rankFeatures,
  tailSummary,
} from './feature-importance'
import type { RunFeatureImportance } from '@/services/model-draft'

function impurity(
  features: { name: string; importance: number }[],
): RunFeatureImportance {
  return {
    algorithm: 'random_forest',
    method: 'impurity',
    standardized: null,
    scaling_methods: [],
    features,
  }
}

function coefficient(
  features: { name: string; importance: number; coefficient: number }[],
  standardized: boolean | null,
): RunFeatureImportance {
  return {
    algorithm: 'ridge',
    method: 'coefficient',
    standardized,
    scaling_methods: standardized ? ['standard'] : [],
    features,
  }
}

describe('rankFeatures', () => {
  it('orders descending by importance and carries rank 1..N', () => {
    const importance = impurity([
      { name: 'a', importance: 0.1 },
      { name: 'b', importance: 0.6 },
      { name: 'c', importance: 0.3 },
    ])
    const ranked = rankFeatures(importance)
    expect(ranked.map(r => r.name)).toEqual(['b', 'c', 'a'])
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('shares are computed against the FULL total, not just the shown slice', () => {
    const features = Array.from({ length: 15 }, (_, i) => ({
      name: `f${i}`,
      importance: i + 1, // 1..15, total = 120
    }))
    const importance = impurity(features)
    const ranked = rankFeatures(importance, 10)
    expect(ranked).toHaveLength(10)
    // Top feature (importance 15) — share against total 120, not against
    // the sum of only the shown 10.
    expect(ranked[0]!.share).toBeCloseTo(15 / 120, 6)
  })

  it('carries the signed coefficient beside the always-non-negative importance', () => {
    const importance = coefficient(
      [{ name: 'a', importance: 0.4, coefficient: -0.4 }],
      true,
    )
    const ranked = rankFeatures(importance)
    expect(ranked[0]!.importance).toBe(0.4)
    expect(ranked[0]!.coefficient).toBe(-0.4)
  })
})

describe('tailSummary', () => {
  it('states shown/total counts and what each half carries — AC23', () => {
    const features = Array.from({ length: 21 }, (_, i) => ({
      name: `f${i}`,
      importance: i === 0 ? 87 : 13 / 20, // one dominant feature, tail small
    }))
    const importance = impurity(features)
    const summary = tailSummary(importance, 10)
    expect(summary.shownCount).toBe(10)
    expect(summary.totalCount).toBe(21)
    expect(summary.topShare + summary.tailShare).toBeCloseTo(1, 6)
  })

  it('a flat distribution reads a small top share and a large tail share', () => {
    const features = Array.from({ length: 21 }, (_, i) => ({
      name: `f${i}`,
      importance: 1,
    }))
    const importance = impurity(features)
    const summary = tailSummary(importance, 10)
    // 10 of 21 equal features shown -> top share ~= 10/21.
    expect(summary.topShare).toBeCloseTo(10 / 21, 2)
  })
})

describe('canRank', () => {
  it('impurity is always rankable regardless of standardized', () => {
    expect(canRank(impurity([{ name: 'a', importance: 1 }]))).toBe(true)
  })

  it('a scaled coefficient run is rankable — AC27', () => {
    const importance = coefficient(
      [{ name: 'a', importance: 1, coefficient: 1 }],
      true,
    )
    expect(canRank(importance)).toBe(true)
  })

  it('an unscaled coefficient run refuses ranking — AC27', () => {
    const importance = coefficient(
      [{ name: 'a', importance: 1, coefficient: 1 }],
      false,
    )
    expect(canRank(importance)).toBe(false)
  })

  it('a legacy run with no scaling recorded (standardized: null) also refuses ranking', () => {
    const importance = coefficient(
      [{ name: 'a', importance: 1, coefficient: 1 }],
      null,
    )
    expect(canRank(importance)).toBe(false)
  })
})

describe('observationsPerFeature', () => {
  it('divides distinct labelled values by feature count', () => {
    expect(observationsPerFeature(32, 21)).toBeCloseTo(32 / 21, 6)
  })

  it('reads null when splitStats is absent — the candidate-job-run case (AC26)', () => {
    expect(observationsPerFeature(null, 21)).toBeNull()
    expect(observationsPerFeature(undefined, 21)).toBeNull()
  })

  it('reads null when feature count is missing or zero', () => {
    expect(observationsPerFeature(32, null)).toBeNull()
    expect(observationsPerFeature(32, 0)).toBeNull()
  })
})
