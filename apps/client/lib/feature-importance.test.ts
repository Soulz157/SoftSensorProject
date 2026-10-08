import { describe, it, expect } from 'vitest'
import {
  canRank,
  observationsPerFeature,
  populationCountLabel,
  rankFeatures,
  rankPermutationFeatures,
  tailSummary,
} from './feature-importance'
import type {
  RunFeatureImportance,
  RunPermutationImportance,
} from '@/services/model-draft'

function permutation(
  features: {
    name: string
    importance: number
    importance_raw: number
    std: number
  }[],
): RunPermutationImportance {
  return {
    algorithm: 'lstm',
    method: 'permutation',
    scored_on: 'test_windows',
    n: 3084,
    metric: 'rmse',
    n_repeats: 10,
    baseline_score: 0.42,
    features,
  }
}

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

  // MODEL-FLOW-019-T32 / AC70 / V44. The new method ranks — and proving AC27
  // was not relaxed to get there is the point of the second assertion: a
  // PLAIN coefficient over inputs with no recorded scaling is still refused,
  // in the same test, against the same shape.
  it('a standardized-coefficient run ranks, while a plain unscaled coefficient is still refused — AC70 with AC27 intact', () => {
    const standardizedCoefficient: RunFeatureImportance = {
      algorithm: 'ridge',
      method: 'standardized-coefficient',
      standardized: true,
      scaling_methods: [],
      features: [{ name: 'a', importance: 2, coefficient: 1 }],
    }
    expect(canRank(standardizedCoefficient)).toBe(true)

    expect(
      canRank(
        coefficient([{ name: 'a', importance: 1, coefficient: 1 }], false),
      ),
    ).toBe(false)
  })

  it('the method name alone never confers rankability — the flag does', () => {
    // Guards the SHAPE of the fix: an edit that special-cased the string
    // 'standardized-coefficient' the way 'impurity' is special-cased would
    // rank a run the trainer explicitly marked as not comparable.
    const mislabelled: RunFeatureImportance = {
      algorithm: 'ridge',
      method: 'standardized-coefficient',
      standardized: false,
      scaling_methods: [],
      features: [{ name: 'a', importance: 2, coefficient: 1 }],
    }
    expect(canRank(mislabelled)).toBe(false)
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

describe('rankPermutationFeatures — MODEL-FLOW-023-T10', () => {
  it('ranks only features whose clamped importance is positive; a non-positive one keeps its row with a null rank and 0% share', () => {
    const importance = permutation([
      { name: 'TI-101', importance: 0.05, importance_raw: 0.05, std: 0.01 },
      // importance_raw <= 0 -> clamped to 0 -> not ranked, per the trainer's
      // own clamp (AC7) — this is the SAME decision, not a second one.
      { name: 'PI-201', importance: 0, importance_raw: -0.02, std: 0.03 },
      { name: 'FI-301', importance: 0.03, importance_raw: 0.03, std: 0.005 },
    ])
    const ranked = rankPermutationFeatures(importance, 10)
    expect(ranked.map(r => r.name)).toEqual(['TI-101', 'FI-301', 'PI-201'])
    expect(ranked[0]!.rank).toBe(1)
    expect(ranked[1]!.rank).toBe(2)
    expect(ranked[2]!.rank).toBeNull()
    expect(ranked[2]!.share).toBe(0)
    // Share denominator excludes the unranked feature — the two ranked
    // features' shares sum to 100%.
    expect(ranked[0]!.share + ranked[1]!.share).toBeCloseTo(1, 6)
  })

  it('never abs()s importance_raw — the signed value rides beside the clamped one', () => {
    const importance = permutation([
      { name: 'PI-201', importance: 0, importance_raw: -0.02, std: 0.03 },
    ])
    const [row] = rankPermutationFeatures(importance, 10)
    expect(row!.importanceRaw).toBe(-0.02)
    expect(row!.importance).toBe(0)
  })

  it('limits to the requested count, sorted by clamped importance descending', () => {
    const importance = permutation(
      Array.from({ length: 15 }, (_, i) => ({
        name: `tag-${i}`,
        importance: 15 - i,
        importance_raw: 15 - i,
        std: 0.1,
      })),
    )
    const ranked = rankPermutationFeatures(importance, 10)
    expect(ranked).toHaveLength(10)
    expect(ranked[0]!.name).toBe('tag-0')
    expect(ranked[0]!.importance).toBe(15)
  })

  it('reads 0% share, not NaN, when every feature is unranked', () => {
    const importance = permutation([
      { name: 'PI-201', importance: 0, importance_raw: -0.02, std: 0.03 },
      { name: 'FI-301', importance: 0, importance_raw: -0.01, std: 0.02 },
    ])
    const ranked = rankPermutationFeatures(importance, 10)
    expect(ranked.every(r => r.rank === null)).toBe(true)
    expect(ranked.every(r => r.share === 0)).toBe(true)
  })
})

describe('populationCountLabel — MODEL-FLOW-023-T10/AC16', () => {
  it('labels a sequence population in windows, never rows', () => {
    expect(populationCountLabel('test_windows', 3084)).toBe('3,084 windows')
  })

  it('labels a non-sequence population in rows', () => {
    expect(populationCountLabel('holdout', 1153)).toBe('1,153 rows')
  })

  it('singularises at n=1', () => {
    expect(populationCountLabel('test_windows', 1)).toBe('1 window')
    expect(populationCountLabel('holdout', 1)).toBe('1 row')
  })
})
