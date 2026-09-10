/**
 * MODEL-FLOW-019-T31 — V41, V42, V43.
 *
 * The fixtures here are shaped after the reference table the user supplied,
 * because that table is the argument for the whole design: its n=7 and n=4
 * differ by 0.8 percent while its n=6 is worse than its n=5. A test built on
 * a clean monotone curve would pass against a plain argmin and prove nothing.
 */

import { describe, it, expect } from 'vitest'
import {
  admissibleFolds,
  buildSweepRows,
  prefixesFromSeed,
  selectByOverlap,
  sweepProvenanceText,
  sweepRuleText,
  type SweepRow,
} from './feature-count-sweep'
import type {
  ModelTrainingRunListItem,
  RunFeatureImportance,
} from '@/services/model-draft'

function seed(names: string[]): RunFeatureImportance {
  return {
    algorithm: 'random_forest',
    method: 'impurity',
    standardized: null,
    scaling_methods: [],
    // Descending importance, so the ranking order is the array order.
    features: names.map((name, i) => ({ name, importance: names.length - i })),
  }
}

function row(over: Partial<SweepRow>): SweepRow {
  return {
    runId: 'r',
    status: 'SUCCEEDED',
    n: 1,
    features: [],
    rmse: { mean: null, std: null },
    r2: { mean: null, std: null },
    obsPerFeature: null,
    ...over,
  }
}

function cvRun(over: Record<string, unknown>) {
  return {
    id: 'run',
    status: 'SUCCEEDED',
    cvFoldsKey: 'cv-key',
    featureColumns: null,
    metrics: {},
    ...over,
  } as unknown as ModelTrainingRunListItem
}

describe('prefixesFromSeed', () => {
  it('applies ONE ranking as a prefix per count — AC66', () => {
    const rows = prefixesFromSeed(seed(['a', 'b', 'c']), [1, 2, 3])
    expect(rows.map(r => r.features)).toEqual([
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
    ])
  })

  it('drops counts larger than the feature set instead of clamping them', () => {
    // Two rows both meaning "all 3 features" would put a duplicate point on
    // the curve and invite reading the gap between them as signal.
    const rows = prefixesFromSeed(seed(['a', 'b', 'c']), [2, 3, 4, 7])
    expect(rows.map(r => r.n)).toEqual([2, 3])
  })

  it('orders by importance, not by the order features happen to arrive in', () => {
    const unordered: RunFeatureImportance = {
      algorithm: 'ridge',
      method: 'standardized-coefficient',
      standardized: true,
      scaling_methods: [],
      features: [
        { name: 'low', importance: 0.1 },
        { name: 'high', importance: 0.9 },
      ],
    }
    expect(prefixesFromSeed(unordered, [1])[0]?.features).toEqual(['high'])
  })
})

describe('buildSweepRows', () => {
  it('reads n from the run’s own recorded feature_count, not the request', () => {
    // The request echo and the record disagree here ON PURPOSE: only the
    // record says what was fit, and the table must follow it.
    const rows = buildSweepRows(
      [
        cvRun({
          id: 'a',
          featureColumns: ['x', 'y', 'z'],
          metrics: { feature_count: 2, cv_rmse_mean: 0.5, cv_rmse_std: 0.01 },
        }),
      ],
      32,
    )
    expect(rows[0]?.n).toBe(2)
  })

  it('carries the fold spread as the row’s interval — AC67', () => {
    const rows = buildSweepRows(
      [
        cvRun({
          id: 'a',
          metrics: {
            feature_count: 4,
            cv_rmse_mean: 0.0526,
            cv_rmse_std: 0.004,
            cv_r2_mean: 0.61,
            cv_r2_std: 0.05,
          },
        }),
      ],
      32,
    )
    expect(rows[0]?.rmse).toEqual({ mean: 0.0526, std: 0.004 })
    expect(rows[0]?.r2).toEqual({ mean: 0.61, std: 0.05 })
  })

  it('computes obs/feature on DISTINCT LABELLED VALUES — AC68', () => {
    const rows = buildSweepRows(
      [cvRun({ metrics: { feature_count: 7, cv_rmse_mean: 0.05 } })],
      32,
    )
    // 32 / 7 = 4.57 — the figure that says the top row is interpolating.
    expect(rows[0]?.obsPerFeature).toBeCloseTo(32 / 7, 5)
  })

  it('keeps a still-running row rather than dropping it from the curve', () => {
    const rows = buildSweepRows(
      [
        cvRun({ id: 'done', metrics: { feature_count: 1, cv_rmse_mean: 0.9 } }),
        cvRun({ id: 'running', status: 'RUNNING', metrics: {} }),
      ],
      32,
    )
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.runId === 'running')?.rmse.mean).toBeNull()
  })
})

describe('selectByOverlap — V41', () => {
  it('picks the SMALLEST overlapping n where the rule and the argmin DISAGREE', () => {
    // Shaped after the user's own table: n=7 is the minimum, but n=4 is
    // within a fold spread of it. A fixture where the two agree could not
    // tell a stated rule from a minimum.
    const rows = [
      row({ runId: 'n4', n: 4, rmse: { mean: 0.0526, std: 0.004 } }),
      row({ runId: 'n7', n: 7, rmse: { mean: 0.0522, std: 0.004 } }),
    ]
    const picked = selectByOverlap(rows)
    expect(picked.bestRunId).toBe('n7')
    expect(picked.chosenRunId).toBe('n4')
    expect(picked.chosenN).toBe(4)
  })

  it('does not pick a smaller n whose interval misses the best row entirely', () => {
    const rows = [
      row({ runId: 'n1', n: 1, rmse: { mean: 0.2, std: 0.001 } }),
      row({ runId: 'n4', n: 4, rmse: { mean: 0.05, std: 0.004 } }),
    ]
    expect(selectByOverlap(rows).chosenRunId).toBe('n4')
  })

  it('reproduces the self-contradiction in the reference table without tripping', () => {
    // n=6 (0.0554) is WORSE than n=5 (0.0550) — an ordering that already
    // contradicts itself. The rule must still return the smallest row that
    // overlaps the best, not follow the bumps.
    const rows = [
      row({ runId: 'n4', n: 4, rmse: { mean: 0.0526, std: 0.004 } }),
      row({ runId: 'n5', n: 5, rmse: { mean: 0.055, std: 0.004 } }),
      row({ runId: 'n6', n: 6, rmse: { mean: 0.0554, std: 0.004 } }),
      row({ runId: 'n7', n: 7, rmse: { mean: 0.0522, std: 0.004 } }),
    ]
    const picked = selectByOverlap(rows)
    expect(picked.bestN).toBe(7)
    expect(picked.chosenN).toBe(4)
  })
})

describe('selectByOverlap — V42, a row with no interval makes no claim', () => {
  it('never places a row that has a mean but no spread', () => {
    const rows = [
      // The LOWEST mean of the three, and still not selectable: with no
      // spread it cannot be shown to overlap anything, and placing it by its
      // mean alone would be the argmin the rule exists to refuse.
      row({ runId: 'no-spread', n: 2, rmse: { mean: 0.01, std: null } }),
      row({ runId: 'n4', n: 4, rmse: { mean: 0.0526, std: 0.004 } }),
      row({ runId: 'n7', n: 7, rmse: { mean: 0.0522, std: 0.004 } }),
    ]
    const picked = selectByOverlap(rows)
    expect(picked.bestRunId).not.toBe('no-spread')
    expect(picked.chosenRunId).toBe('n4')
  })

  it('orders nothing at all when no row has an interval', () => {
    const rows = [
      row({ runId: 'a', n: 1, rmse: { mean: 0.5, std: null } }),
      row({ runId: 'b', n: 2, rmse: { mean: 0.4, std: null } }),
    ]
    expect(selectByOverlap(rows)).toEqual({
      chosenRunId: null,
      chosenN: null,
      bestRunId: null,
      bestN: null,
    })
  })
})

describe('the printed sentences — AC66, AC67, AC69, V43', () => {
  it('states the rule rather than implying it with a bold row', () => {
    expect(sweepRuleText()).toMatch(/smallest feature count/i)
    expect(sweepRuleText()).toMatch(/not by the lowest number/i)
  })

  it('names ONE seed run and its method, and calls the ranking provisional', () => {
    const text = sweepProvenanceText(
      '90027dae-43ce-490e-8620-7384083c41ec',
      'impurity',
      'impurity',
    )
    expect(text).toMatch(/90027dae/)
    expect(text).toMatch(/impurity/)
    expect(text).toMatch(/provisional/)
    expect(text).toMatch(/cardinality/)
    // AC69: the population, and what it was already used to choose.
    expect(text).toMatch(/cross-validation folds/)
    expect(text).toMatch(/not independent of the data it ranks/)
  })

  it('gives a coefficient seed its OWN bias sentence, not impurity’s', () => {
    const text = sweepProvenanceText(
      'abcdef12-0000-4000-8000-000000000000',
      'standardized-coefficient',
      'standardized coefficient',
    )
    expect(text).toMatch(/sees no interaction/)
    expect(text).not.toMatch(/cardinality/)
  })

  // V29's whole-container rule reaches this text once the table is on Step 5.
  it('never says "confidence" or "predictive interval"', () => {
    const all = [
      sweepRuleText(),
      sweepProvenanceText('abcdef12', 'impurity', 'impurity'),
    ].join(' ')
    expect(all).not.toMatch(/confidence/i)
    expect(all).not.toMatch(/predictive interval/i)
  })
})

/**
 * MODEL-FLOW-019-T31. `admissibleFolds` against the trainer's OWN authority.
 *
 * `assert_admissible_fold_count` (images/trainer/app/splits.py) computes
 * `max_admissible_k = distinct_labelled_values // MIN_LABELS_PER_FOLD` and
 * refuses when `n_splits > max_admissible_k`. A launcher that derived k from
 * the `k + 1` partition count `expanding_fold_plan` uses instead would fire a
 * whole ladder of runs that each fail at fit time — seven container spawns and
 * a table of nulls. These pin the two together.
 */
describe('admissibleFolds', () => {
  it('returns the MAXIMUM k the trainer would accept, not one fewer', () => {
    // 32 distinct is this system's own measured effective sample size.
    expect(admissibleFolds(32)).toBe(3) // 32 // 10 = 3, and 3 > 3 is false
    expect(admissibleFolds(97)).toBe(9)
    expect(admissibleFolds(20)).toBe(2)
  })

  it('refuses rather than degrading where no k is admissible', () => {
    // Below 20 the trainer's max_admissible_k is 1, and a single split
    // returns no spread — so there is nothing to put an interval on.
    expect(admissibleFolds(19)).toBeNull()
    expect(admissibleFolds(0)).toBeNull()
    expect(admissibleFolds(null)).toBeNull()
  })

  it('never exceeds the run DTO’s own 2-10 bound', () => {
    expect(admissibleFolds(5000)).toBe(10)
  })
})
