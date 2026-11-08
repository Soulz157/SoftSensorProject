import { describe, it, expect } from 'vitest'
import {
  breakdownRuntime,
  cvFitCount,
  estimateRuntimeSeconds,
  PARALLEL_EFFICIENCY,
  searchSpeedup,
  searchWorkersFor,
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

  it('prices two algorithms from the SELECTED ones only, not every entry in the cost table', () => {
    // 1.0 + 1.3 = 2.3 units at 10s each.
    expect(est({ algorithms: ['lightgbm', 'xgboost'] })).toBeCloseTo(23, 6)
  })

  it('prices each added row as one more fit of its algorithm', () => {
    // lightgbm x2 (card + one row) + xgboost x1 = 2.0 + 1.3 = 3.3 units.
    expect(
      est({
        algorithms: ['lightgbm', 'xgboost'],
        candidatesPerAlgorithm: { lightgbm: 2, xgboost: 1 },
      }),
    ).toBeCloseTo(33, 6)
  })

  it('prices sweep-then-tune as the sweep plus 4 variants of the average selected algorithm', () => {
    const both = est({
      algorithms: ['lightgbm', 'xgboost'],
      findBestParams: true,
    })
    // (1.0 + 1.3) + 4 x mean(1.0, 1.3) = 2.3 + 4.6 = 6.9 units.
    expect(both).toBeCloseTo(69, 6)
  })

  it('costs an algorithm the table does not know as 1, and never prices an empty selection as 0', () => {
    // `grp` is in the catalogue but has no measured cost yet.
    expect(est({ algorithms: ['grp'] })).toBeCloseTo(10, 6)
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
    })
    expect(shares.map(s => s.id).sort()).toEqual(['lightgbm', 'xgboost'])
  })

  it('shares sum to the headline estimate and to 100%, tuning included', () => {
    for (const input of [
      { ...BASE, algorithms: ['lightgbm', 'xgboost', 'ridge'] },
      {
        ...BASE,
        algorithms: ['lightgbm', 'xgboost'],
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

describe('estimateRuntimeSeconds — real variant counts (MODEL-FLOW-025-T06)', () => {
  const one = est()

  it('with no count known, prices a search at the cap: base + 4 fits', () => {
    expect(est({ findBestParams: true })).toBeCloseTo(one * 5, 6)
  })

  it('prices a direct search at the variants the preview says will run', () => {
    const tune = (n: number) =>
      est({ findBestParams: true, tuningVariants: { lightgbm: n } })
    expect(tune(3)).toBeCloseTo(one * 4, 6)
    expect(tune(0)).toBeCloseTo(one, 6)
  })

  it('averages each algorithm’s own count x cost for a sweep, whose winner is unknown', () => {
    // lightgbm costs 1.0 and xgboost 1.3. Base = 2.3; tuning = mean(2x1.0, 4x1.3).
    const sweep = est({
      algorithms: ['lightgbm', 'xgboost'],
      findBestParams: true,
      tuningVariants: { lightgbm: 2, xgboost: 4 },
    })
    expect(sweep).toBeCloseTo(one * (2.3 + (2 * 1.0 + 4 * 1.3) / 2), 6)
  })

  it('falls back to the cap only for the algorithm with no count', () => {
    const partial = est({
      algorithms: ['lightgbm', 'xgboost'],
      findBestParams: true,
      tuningVariants: { lightgbm: 2 },
    })
    expect(partial).toBeCloseTo(one * (2.3 + (2 * 1.0 + 4 * 1.3) / 2), 6)
  })

  it('ignores counts while Find Best Parameters is off', () => {
    expect(est({ tuningVariants: { lightgbm: 3 } })).toBeCloseTo(one, 6)
  })
})

describe('Cross-Validation pricing (MODEL-FLOW-029)', () => {
  it('prices a single CV run as k folds plus the refit', () => {
    expect(est({ nSplits: 5 })).toBeCloseTo(est() * 6, 6)
  })

  it('prices a CV search as every variant times k+1', () => {
    const search = { findBestParams: true, tuningVariants: { lightgbm: 4 } }
    expect(est({ ...search, nSplits: 3 })).toBeCloseTo(est(search) * 4, 6)
  })

  it('is unchanged with CV off', () => {
    expect(est({ nSplits: undefined })).toBeCloseTo(est(), 6)
  })
})

describe('cvFitCount (MODEL-FLOW-029)', () => {
  it('is null with CV off', () => {
    expect(cvFitCount(BASE)).toBeNull()
  })

  it('counts one candidate for a plain CV run', () => {
    expect(cvFitCount({ ...BASE, nSplits: 5 })).toEqual({
      candidates: 1,
      fitsEach: 6,
      total: 6,
    })
  })

  it('counts the base plus every variant for a CV search', () => {
    expect(
      cvFitCount({
        ...BASE,
        nSplits: 5,
        findBestParams: true,
        tuningVariants: { lightgbm: 7 },
      }),
    ).toEqual({ candidates: 8, fitsEach: 6, total: 48 })
  })
})

describe('grid search pricing (MODEL-FLOW-038)', () => {
  const grid = { findBestParams: true, gridFits: 12 }

  it('prices the search fits plus the winner’s single run', () => {
    // 12 search fits + the winner's one fit, each lightgbm's 10s.
    expect(est(grid)).toBeCloseTo(est() * 13, 6)
  })

  it('prices the winner as k folds plus a refit under CV', () => {
    // gridFits already counts combos x folds; the winner adds k+1.
    expect(est({ ...grid, nSplits: 3 })).toBeCloseTo(est() * (12 + 4), 6)
  })

  it('replaces the curated-variant pricing rather than adding to it', () => {
    expect(est({ ...grid, tuningVariants: { lightgbm: 99 } })).toBeCloseTo(
      est(grid),
      6,
    )
  })

  it('is ignored when Find Best Parameters is off', () => {
    expect(est({ findBestParams: false, gridFits: 12 })).toBeCloseTo(est(), 6)
  })

  it('states the search and the winner’s fits separately under CV', () => {
    expect(cvFitCount({ ...BASE, ...grid, nSplits: 3 })).toEqual({
      candidates: 1,
      fitsEach: 4,
      total: 16,
      searchFits: 12,
    })
  })
})

describe('measured forest costs (MODEL-FLOW-038)', () => {
  // One fit, 100 trees, default depth, measured in the trainer image:
  // random_forest 104-151 and extra_trees 29-37 where lightgbm is 0.6-1.7.
  it('prices random_forest and extra_trees in the measured ranges, not like lightgbm', () => {
    const lightgbm = est({ algorithms: ['lightgbm'] })
    const forest = est({ algorithms: ['random_forest'] }) / lightgbm
    const extra = est({ algorithms: ['extra_trees'] }) / lightgbm
    expect(forest).toBeGreaterThanOrEqual(104)
    expect(forest).toBeLessThanOrEqual(151)
    expect(extra).toBeGreaterThanOrEqual(29)
    expect(extra).toBeLessThanOrEqual(37)
  })

  it('reproduces a measured single fit to within the panel’s own range', () => {
    // 30,000 rows x 20 features, 100 trees: extra_trees took 9.56s here, and
    // random_forest 36.76s. The panel shows est*0.6 .. est*2.
    const at = (algorithm: string) =>
      estimateRuntimeSeconds({
        ...BASE,
        rows: 30_000,
        features: 20,
        algorithms: [algorithm],
      })
    expect(at('extra_trees') * 0.6).toBeLessThan(9.56)
    expect(at('extra_trees') * 2).toBeGreaterThan(9.56)
    expect(at('random_forest') * 0.6).toBeLessThan(36.76)
    expect(at('random_forest') * 2).toBeGreaterThan(36.76)
  })

  it('reads a wide forest search as long, not as seconds', () => {
    // The shape of the run that sat at 100% of one core for 25+ minutes: 34,030
    // rows and a 27-combination extra_trees search. Its feature count is not
    // known here, so this takes a wide 100-feature table — one default-depth
    // extra_trees fit there is ~55s, ~28 fits is ~25 min — and asserts the
    // estimate is past the panel's 15-minute long-run line. The same search
    // on 20 features reads ~5 minutes, which matches a measured 11s per fit.
    const search = {
      ...BASE,
      rows: 34_030,
      algorithms: ['extra_trees'],
      findBestParams: true,
      gridFits: 27,
    }
    expect(
      estimateRuntimeSeconds({ ...search, features: 100 }),
    ).toBeGreaterThan(900)
    const narrow = estimateRuntimeSeconds({ ...search, features: 20 })
    expect(narrow).toBeGreaterThan(200)
    expect(narrow).toBeLessThan(900)
  })
})

describe('search workers (MODEL-FLOW-038)', () => {
  const grid = {
    rows: 30_000,
    features: 20,
    algorithms: ['extra_trees'],
    findBestParams: true,
    gridFits: 18,
  }

  it('divides the search — not the winner’s run — by the measured speed-up', () => {
    const serial = est({ ...grid })
    const two = est({ ...grid, searchWorkers: 2 })
    const oneFit = est({ ...grid, gridFits: 0 })
    // Search part: 18 fits at 1/1.5 the time, plus the winner's one fit.
    expect(two - oneFit).toBeCloseTo((serial - oneFit) / searchSpeedup(2), 6)
    expect(two).toBeLessThan(serial)
  })

  it('treats a missing or single worker as serial, so an unknown count never under-estimates', () => {
    expect(est({ ...grid, searchWorkers: undefined })).toBe(est({ ...grid }))
    expect(est({ ...grid, searchWorkers: 1 })).toBe(est({ ...grid }))
  })

  it('has the speed-up the measurements gave: 1.5x on 2 workers', () => {
    expect(PARALLEL_EFFICIENCY).toBe(0.75)
    expect(searchSpeedup(2)).toBe(1.5)
    expect(searchSpeedup(1)).toBe(1)
    expect(searchSpeedup(undefined)).toBe(1)
  })

  it('does not divide when Find Best Parameters is off', () => {
    expect(
      est({ ...grid, findBestParams: false, searchWorkers: 2 }),
    ).toBeCloseTo(est({ ...grid, findBestParams: false }), 6)
  })
})

describe('searchWorkersFor (same rule as the trainer’s search_parallelism)', () => {
  // The cases images/trainer/test/test_grid_search.py pins for
  // `search_parallelism`; a change on either side must change both.
  it.each([
    [true, 2, 18, 2], // the production case
    [true, 4, 18, 4], // more CPUs -> more workers
    [true, 8, 3, 3], // never more workers than fits
    [true, 4, 1, 1], // one fit has nothing to run beside
    [true, 1, 18, 1], // a one-CPU budget stays serial
    [false, 2, 18, 1], // lightgbm, ridge… are not parallelised
  ])(
    'parallel=%s budget=%s tasks=%s -> %s workers',
    (parallel, budget, tasks, expected) => {
      expect(searchWorkersFor(parallel, budget, tasks)).toBe(expected)
    },
  )
})
