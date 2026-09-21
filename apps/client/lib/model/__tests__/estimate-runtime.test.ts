import { describe, it, expect } from 'vitest'
import {
  breakdownRuntime,
  estimateRuntimeSeconds,
  type RuntimeInput,
} from '@/lib/model/estimate-runtime'

/**
 * MODEL-FLOW-024-T05. Large `rows` on purpose: the estimate is floored at 2s,
 * and a fixture small enough to hit the floor would make every ratio below
 * read 1. At 20M rows x 1 feature, cost 1.0 is 10s, well clear of it.
 */
const BASE: RuntimeInput = {
  rows: 20_000_000,
  features: 1,
  algorithms: ['lightgbm'],
  targets: 1,
  findBestModel: false,
  findBestParams: false,
}

const est = (overrides: Partial<RuntimeInput> = {}) =>
  estimateRuntimeSeconds({ ...BASE, ...overrides })

describe('estimateRuntimeSeconds (MODEL-FLOW-024-T05)', () => {
  it('prices one fit as cells x cost', () => {
    // lightgbm is the table's 1.0 anchor: 20M cells / 2M per second.
    expect(est()).toBeCloseTo(10, 6)
  })

  it('prices Find Best Parameters on one algorithm as the base fit plus 4 variants — 5x, not the old 10x', () => {
    expect(est({ findBestParams: true }) / est()).toBeCloseTo(5, 6)
  })

  it('prices a sweep from the SELECTED algorithms only, not every entry in the cost table', () => {
    const sweep = est({
      algorithms: ['lightgbm', 'xgboost'],
      findBestModel: true,
    })
    // 1.0 + 1.3 = 2.3 units at 10s each.
    expect(sweep).toBeCloseTo(23, 6)
    // And it is the same number as fitting those two without a sweep.
    expect(sweep).toBeCloseTo(
      est({ algorithms: ['lightgbm', 'xgboost'], findBestModel: false }),
      6,
    )
  })

  it('prices sweep-then-tune as the sweep plus 4 variants of the average selected algorithm', () => {
    const both = est({
      algorithms: ['lightgbm', 'xgboost'],
      findBestModel: true,
      findBestParams: true,
    })
    // (1.0 + 1.3) + 4 x mean(1.0, 1.3) = 2.3 + 4.6 = 6.9 units.
    expect(both).toBeCloseTo(69, 6)
  })

  it('costs an algorithm the table does not know as 1, and never prices an empty selection as 0', () => {
    expect(est({ algorithms: ['random_forest'] })).toBeCloseTo(10, 6)
    expect(est({ algorithms: [] })).toBeCloseTo(10, 6)
  })

  it('keeps the 2s floor for tiny datasets', () => {
    expect(est({ rows: 10 })).toBe(2)
  })

  it('still scales with targets and tree count', () => {
    expect(est({ targets: 3 })).toBeCloseTo(30, 6)
    expect(est({ nEstimators: 200 })).toBeCloseTo(20, 6)
  })
})

describe('breakdownRuntime (MODEL-FLOW-024-T05)', () => {
  it('lists only the selected algorithms, even for a sweep', () => {
    const shares = breakdownRuntime({
      ...BASE,
      algorithms: ['lightgbm', 'xgboost'],
      findBestModel: true,
    })
    expect(shares.map(s => s.id).sort()).toEqual(['lightgbm', 'xgboost'])
  })

  it('shares sum to the headline estimate and to 100%, tuning included', () => {
    for (const input of [
      { ...BASE, algorithms: ['lightgbm', 'xgboost', 'ridge'] },
      {
        ...BASE,
        algorithms: ['lightgbm', 'xgboost'],
        findBestModel: true,
        findBestParams: true,
      },
      { ...BASE, findBestParams: true },
    ]) {
      const shares = breakdownRuntime(input)
      expect(shares.reduce((s, x) => s + x.seconds, 0)).toBeCloseTo(
        estimateRuntimeSeconds(input),
        6,
      )
      expect(shares.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6)
    }
  })

  it('shares still sum to the headline when the 2s floor binds', () => {
    // The old per-algorithm re-estimate floored EACH share at 2s, so three
    // cheap algorithms summed past the headline. Scaling one total cannot.
    const input = {
      ...BASE,
      rows: 10,
      algorithms: ['ridge', 'ols', 'lightgbm'],
    }
    const shares = breakdownRuntime(input)
    expect(shares.reduce((s, x) => s + x.seconds, 0)).toBeCloseTo(
      estimateRuntimeSeconds(input),
      6,
    )
  })

  it('sorts the costliest first and returns nothing for an empty selection', () => {
    const shares = breakdownRuntime({
      ...BASE,
      algorithms: ['ridge', 'xgboost'],
    })
    expect(shares[0]?.id).toBe('xgboost')
    expect(breakdownRuntime({ ...BASE, algorithms: [] })).toEqual([])
  })
})
