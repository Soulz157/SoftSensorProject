import { describe, expect, it } from 'vitest'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import {
  combinationCount,
  effectiveGrid,
  fitCount,
  formatGridValues,
  gridRefusal,
  parseGridValues,
} from '@/lib/param-grid'

const field = (algorithm: keyof typeof HYPERPARAMS, key: string) => {
  const found = HYPERPARAMS[algorithm].find(f => f.key === key)
  if (!found) throw new Error(`${algorithm}.${key} is not in the catalogue`)
  return found
}

const ALPHA = field('ridge', 'alpha') // number, fractional step
const N_ESTIMATORS = field('xgboost', 'n_estimators') // number, whole step
const MAX_DEPTH = field('random_forest', 'max_depth') // nullable-number
const KERNEL = field('svm', 'kernel') // select
const FIT_INTERCEPT = field('ols', 'fit_intercept') // checkbox

const LIMITS = { maxCombinations: 64, maxValuesPerKey: 10 }

describe('parseGridValues', () => {
  it('reads a comma list of numbers', () => {
    expect(parseGridValues(ALPHA, '0.1, 1, 10')).toEqual({
      values: [0.1, 1, 10],
      errors: [],
    })
  })

  it('trims, drops empty tokens and drops repeats', () => {
    expect(parseGridValues(ALPHA, ' 1,,1 , 2 ,').values).toEqual([1, 2])
  })

  it('reads exponent notation', () => {
    expect(parseGridValues(ALPHA, '1e-3, 2.5E1').values).toEqual([0.001, 25])
  })

  it.each(['abc', '0x10', 'Infinity', '1.2.3', '--1'])(
    'names "%s" as not a number',
    token => {
      const { values, errors } = parseGridValues(ALPHA, `1, ${token}`)
      expect(values).toEqual([1])
      expect(errors).toEqual([expect.stringContaining(token)])
    },
  )

  it('keeps the good values beside a bad token', () => {
    const { values, errors } = parseGridValues(ALPHA, '0.1, nope, 10')
    expect(values).toEqual([0.1, 10])
    expect(errors).toHaveLength(1)
  })

  it('rejects a decimal for a whole-number field only', () => {
    expect(parseGridValues(N_ESTIMATORS, '100, 250.5').errors).toEqual([
      expect.stringContaining('whole number'),
    ])
    expect(parseGridValues(ALPHA, '2.5').errors).toEqual([])
  })

  it('respects a field minimum', () => {
    expect(parseGridValues(ALPHA, '-1').errors).toEqual([
      expect.stringContaining('minimum'),
    ])
  })

  it('reads None / unlimited as null on a nullable number only', () => {
    expect(parseGridValues(MAX_DEPTH, 'None, 10, UNLIMITED').values).toEqual([
      null,
      10,
    ])
    expect(parseGridValues(ALPHA, 'None').errors).toHaveLength(1)
  })

  it('accepts only a select field’s own options', () => {
    expect(parseGridValues(KERNEL, 'rbf, linear').values).toEqual([
      'rbf',
      'linear',
    ])
    const { errors } = parseGridValues(KERNEL, 'rbf, bogus')
    expect(errors).toEqual([expect.stringContaining('bogus')])
    expect(errors[0]).toContain('rbf')
  })

  it('reads true/false/on/off for a checkbox', () => {
    expect(parseGridValues(FIT_INTERCEPT, 'true, OFF').values).toEqual([
      true,
      false,
    ])
    expect(parseGridValues(FIT_INTERCEPT, 'maybe').errors).toHaveLength(1)
  })

  it('does not lock out a key the form does not know', () => {
    expect(parseGridValues(undefined, '5, foo').values).toEqual([5, 'foo'])
  })

  it('returns nothing for empty text', () => {
    expect(parseGridValues(ALPHA, '  ')).toEqual({ values: [], errors: [] })
  })
})

describe('formatGridValues', () => {
  it('round-trips through parseGridValues', () => {
    const cases: [HyperparamField, (number | string | boolean | null)[]][] = [
      [ALPHA, [0.01, 0.1, 1, 10]],
      [MAX_DEPTH, [null, 10, 20]],
      [KERNEL, ['rbf', 'linear']],
      [FIT_INTERCEPT, [true, false]],
    ]
    for (const [f, values] of cases) {
      expect(parseGridValues(f, formatGridValues(values)).values).toEqual(
        values,
      )
    }
  })

  it('writes null as None', () => {
    expect(formatGridValues([null, 5])).toBe('None, 5')
  })
})

describe('effectiveGrid', () => {
  const defaults = { alpha: [0.1, 1, 10], fit_intercept: [true, false] }
  const fieldOf = (key: string) => field('ridge', key)

  it('is the defaults, with the base merged in, when nothing was typed', () => {
    const { grid, errors } = effectiveGrid(defaults, {}, { alpha: 3 }, fieldOf)
    expect(grid.alpha).toEqual([0.1, 1, 3, 10])
    expect(grid.fit_intercept).toEqual([true, false])
    expect(errors).toEqual({})
  })

  it('does not add a base value the list already holds', () => {
    const { grid } = effectiveGrid(defaults, {}, { alpha: 1 }, fieldOf)
    expect(grid.alpha).toEqual([0.1, 1, 10])
  })

  it('lets typed text replace a key’s list, keeping the base a grid point', () => {
    const { grid } = effectiveGrid(
      defaults,
      { alpha: '0.5, 5' },
      { alpha: 1 },
      fieldOf,
    )
    expect(grid.alpha).toEqual([0.5, 1, 5])
  })

  it('reports bad text per key and does not fall back to the default', () => {
    const { grid, errors } = effectiveGrid(
      defaults,
      { alpha: '1, nope' },
      {},
      fieldOf,
    )
    expect(errors.alpha).toEqual([expect.stringContaining('nope')])
    expect(grid.alpha).toEqual([1])
  })

  it('treats an emptied box as an error, not as the default', () => {
    const { grid, errors } = effectiveGrid(
      defaults,
      { alpha: ' ' },
      {},
      fieldOf,
    )
    expect(errors.alpha).toEqual(['Enter at least one value'])
    expect(grid.alpha).toEqual([])
  })

  it('never invents a value for a key the base does not carry', () => {
    const { grid } = effectiveGrid(defaults, {}, {}, fieldOf)
    expect(grid.alpha).toEqual([0.1, 1, 10])
  })
})

describe('combinationCount / fitCount', () => {
  it('multiplies the list lengths', () => {
    expect(combinationCount({ a: [1, 2, 3], b: [true, false] })).toBe(6)
    expect(combinationCount({})).toBe(1)
  })

  it('costs every combination on every fold', () => {
    expect(fitCount({ a: [1, 2, 3] }, 4)).toBe(12)
    expect(fitCount({ a: [1, 2, 3] }, 0)).toBe(3)
  })
})

describe('gridRefusal', () => {
  const ok = (grid: Record<string, (number | string | boolean | null)[]>) => ({
    grid,
    errors: {},
  })

  it('is null for a grid inside the limits', () => {
    expect(gridRefusal(ok({ a: [1, 2], b: [3, 4] }), LIMITS)).toBeNull()
  })

  it('names the keys whose text is wrong, before any limit', () => {
    const refusal = gridRefusal(
      { grid: { a: [] }, errors: { a: ['x'] } },
      LIMITS,
    )
    expect(refusal).toContain('a')
  })

  it('refuses more values than one key may hold', () => {
    const many = Array.from({ length: 11 }, (_, i) => i)
    expect(gridRefusal(ok({ a: many }), LIMITS)).toMatch(/at most 10/)
  })

  it('refuses a product over the cap, using the server’s figure', () => {
    const grid = { a: [1, 2, 3, 4, 5], b: [1, 2, 3, 4, 5] } // 25
    expect(gridRefusal(ok(grid), LIMITS)).toBeNull()
    expect(gridRefusal(ok(grid), { ...LIMITS, maxCombinations: 24 })).toMatch(
      /25 combinations/,
    )
  })
})
