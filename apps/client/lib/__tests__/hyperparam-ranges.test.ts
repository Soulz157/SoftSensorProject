import { describe, it, expect } from 'vitest'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import { ALGORITHMS, type Algorithm } from '@/store/model-pipeline'
import {
  SIZE_TIER_LOWER_BOUNDS,
  TIER_BANDS,
  batchSizeBand,
  datasetSizeFrom,
  describeSizing,
  isSizedFor,
  sizeTierFor,
  suggestedRangeFor,
  type SizeTier,
} from '@/lib/hyperparam-ranges'

function field(algorithm: Algorithm, key: string): HyperparamField {
  const found = HYPERPARAMS[algorithm].find(f => f.key === key)
  if (!found) throw new Error(`${algorithm}.${key} is not a form field`)
  return found
}

// One representative row count per tier, derived from the bounds so moving a
// bound moves every fixture below with it.
const ROWS = {
  tiny: Math.floor(SIZE_TIER_LOWER_BOUNDS.small / 2),
  small: SIZE_TIER_LOWER_BOUNDS.small,
  medium: SIZE_TIER_LOWER_BOUNDS.medium,
  large: SIZE_TIER_LOWER_BOUNDS.large * 2,
}

describe('MODEL-FLOW-024: sizeTierFor', () => {
  it.each([
    [0, 'tiny'],
    [SIZE_TIER_LOWER_BOUNDS.small - 1, 'tiny'],
    [SIZE_TIER_LOWER_BOUNDS.small, 'small'],
    [SIZE_TIER_LOWER_BOUNDS.medium - 1, 'small'],
    [SIZE_TIER_LOWER_BOUNDS.medium, 'medium'],
    [SIZE_TIER_LOWER_BOUNDS.large - 1, 'medium'],
    [SIZE_TIER_LOWER_BOUNDS.large, 'large'],
    [100_000, 'large'],
  ] as [number, SizeTier][])('%d rows is %s', (n, tier) => {
    expect(sizeTierFor(n)).toBe(tier)
  })

  it('resolves an unknown figure to medium, never to a tighter tier', () => {
    expect(sizeTierFor(null)).toBe('medium')
    expect(sizeTierFor(undefined)).toBe('medium')
    expect(sizeTierFor(Number.NaN)).toBe('medium')
  })

  it('pins the bounds to the user’s durations of hourly data: 6 months, 1 year, 3 years', () => {
    // The row copy in `describeSizing` states these durations; changing a
    // bound without rewording it must fail here.
    const HOURS_PER_YEAR = 24 * 365
    expect(SIZE_TIER_LOWER_BOUNDS).toEqual({
      small: HOURS_PER_YEAR / 2,
      medium: HOURS_PER_YEAR,
      large: HOURS_PER_YEAR * 3,
    })
  })

  it('puts every dataset this system has measured (4,470-15,441 rows) in small or medium', () => {
    expect([4_470, 8_350, 15_441].map(n => sizeTierFor(n))).toEqual([
      'small',
      'small',
      'medium',
    ])
  })
})

describe('MODEL-FLOW-024: batchSizeBand', () => {
  it('is the fixed 16-128 band for an unknown row count and for 1,024+ rows', () => {
    expect(batchSizeBand(null)).toEqual({ min: 16, max: 128 })
    expect(batchSizeBand(undefined)).toEqual({ min: 16, max: 128 })
    expect(batchSizeBand(1_024)).toEqual({ min: 16, max: 128 })
    expect(batchSizeBand(15_441)).toEqual({ min: 16, max: 128 })
  })

  it('caps at an eighth of the rows, with a floor of 8 on the cap', () => {
    expect(batchSizeBand(400)).toEqual({ min: 12, max: 50 })
    expect(batchSizeBand(100)).toEqual({ min: 4, max: 12 })
    expect(batchSizeBand(20)).toEqual({ min: 4, max: 8 })
    expect(batchSizeBand(0)).toEqual({ min: 4, max: 8 })
  })

  it('never returns an empty band', () => {
    for (const rows of [0, 1, 7, 8, 63, 64, 65, 500, 1_023, 1_024, 99_999]) {
      const { min, max } = batchSizeBand(rows)
      expect(min).toBeLessThan(max)
    }
  })
})

describe('MODEL-FLOW-024: suggestedRangeFor', () => {
  it('is HYPERPARAMS’ own band, the same object, when no size is known', () => {
    for (const algorithm of ALGORITHMS) {
      for (const f of HYPERPARAMS[algorithm]) {
        if (f.kind !== 'number' && f.kind !== 'nullable-number') continue
        expect(suggestedRangeFor(algorithm, f)).toBe(f.suggestedRange)
        expect(suggestedRangeFor(algorithm, f, {})).toBe(f.suggestedRange)
        expect(suggestedRangeFor(algorithm, f, { rows: ROWS.medium })).toBe(
          f.suggestedRange,
        )
      }
    }
  })

  it('shrinks a capacity band for a tiny dataset and widens it for a large one', () => {
    const f = field('xgboost', 'n_estimators')
    const tiny = suggestedRangeFor('xgboost', f, { rows: ROWS.tiny })
    const medium = suggestedRangeFor('xgboost', f, { rows: ROWS.medium })
    const large = suggestedRangeFor('xgboost', f, { rows: ROWS.large })
    expect(tiny?.max).toBeLessThan(medium!.max)
    expect(large?.max).toBeGreaterThan(medium!.max)
    // What the parameter DOES does not change with size.
    expect(tiny?.note).toBe(medium?.note)
  })

  it('does not read the distinct labelled count for a capacity band', () => {
    // 8,350 rows hold 32 distinct values. That used to make it `tiny`; rows
    // alone pick the tier now, so the distinct count moves nothing.
    const f = field('xgboost', 'n_estimators')
    const general = (f as { suggestedRange: unknown }).suggestedRange
    expect(suggestedRangeFor('xgboost', f, { distinctLabelled: 32 })).toBe(
      general,
    )
    expect(
      suggestedRangeFor('xgboost', f, {
        rows: ROWS.medium,
        distinctLabelled: 32,
      }),
    ).toBe(general)
    expect(
      suggestedRangeFor('xgboost', f, {
        rows: ROWS.tiny,
        distinctLabelled: 900,
      }),
    ).toEqual(suggestedRangeFor('xgboost', f, { rows: ROWS.tiny }))
  })

  it('leaves algorithms with no size prior on their own band in every tier', () => {
    for (const algorithm of ['ols', 'grp', 'pls'] as const) {
      for (const f of HYPERPARAMS[algorithm]) {
        if (f.kind !== 'number' && f.kind !== 'nullable-number') continue
        for (const rows of Object.values(ROWS)) {
          expect(suggestedRangeFor(algorithm, f, { rows })).toBe(
            f.suggestedRange,
          )
        }
      }
    }
  })

  it('returns nothing for a select or a checkbox', () => {
    expect(suggestedRangeFor('svm', field('svm', 'kernel'))).toBeUndefined()
    expect(
      suggestedRangeFor('ols', field('ols', 'fit_intercept')),
    ).toBeUndefined()
  })

  it('caps LSTM/GRU batch_size by ROWS and leaves the other sequence bands alone', () => {
    for (const algorithm of ['lstm', 'gru'] as const) {
      const batch = field(algorithm, 'batch_size')
      expect(suggestedRangeFor(algorithm, batch, { rows: 400 })).toMatchObject({
        min: 12,
        max: 50,
      })
      // Distinct labelled values must not move a compute band.
      expect(
        suggestedRangeFor(algorithm, batch, { distinctLabelled: 20 }),
      ).toBe((batch as { suggestedRange: unknown }).suggestedRange)
      const epochs = field(algorithm, 'epochs')
      expect(
        suggestedRangeFor(algorithm, epochs, {
          rows: 400,
          distinctLabelled: 20,
        }),
      ).toBe((epochs as { suggestedRange: unknown }).suggestedRange)
    }
  })

  it('names the cap in the batch note only when it actually binds', () => {
    const batch = field('lstm', 'batch_size')
    expect(suggestedRangeFor('lstm', batch, { rows: 400 })?.note).toContain(
      'an eighth of the rows',
    )
    expect(
      suggestedRangeFor('lstm', batch, { rows: 15_441 })?.note,
    ).not.toContain('an eighth')
  })
})

describe('MODEL-FLOW-024: isSizedFor', () => {
  it('is false until a size is known, and always false for an algorithm with no size prior', () => {
    expect(isSizedFor('xgboost')).toBe(false)
    expect(isSizedFor('xgboost', { rows: ROWS.medium })).toBe(false)
    expect(isSizedFor('xgboost', { rows: ROWS.tiny })).toBe(true)
    // The distinct count sizes nothing any more.
    expect(isSizedFor('xgboost', { distinctLabelled: 32 })).toBe(false)
    expect(isSizedFor('pls', { rows: ROWS.tiny })).toBe(false)
  })

  it('is true for lstm/gru only when the rows cap binds', () => {
    expect(isSizedFor('lstm', { rows: 400 })).toBe(true)
    expect(isSizedFor('lstm', { rows: 15_441 })).toBe(false)
    expect(isSizedFor('gru', { distinctLabelled: 20 })).toBe(false)
  })
})

describe('MODEL-FLOW-024: TIER_BANDS is well-formed', () => {
  it('names only real algorithms and numeric fields, with a non-empty band', () => {
    for (const [algorithm, keys] of Object.entries(TIER_BANDS) as [
      Algorithm,
      NonNullable<(typeof TIER_BANDS)[Algorithm]>,
    ][]) {
      for (const [key, tiers] of Object.entries(keys)) {
        const f = field(algorithm, key)
        expect(
          f.kind === 'number' || f.kind === 'nullable-number',
          `${algorithm}.${key} is not numeric`,
        ).toBe(true)
        for (const band of Object.values(tiers)) {
          expect(band[0]).toBeLessThan(band[1])
        }
      }
    }
  })

  it('orders capacity keys tiny <= medium <= large by their upper bound', () => {
    const capacity = new Set([
      'n_estimators',
      'num_leaves',
      'max_depth',
      'hidden_layer_sizes',
    ])
    for (const algorithm of ALGORITHMS) {
      for (const f of HYPERPARAMS[algorithm]) {
        if (!capacity.has(f.key)) continue
        const at = (rows: number) => suggestedRangeFor(algorithm, f, { rows })
        const tiny = at(ROWS.tiny)
        const medium = at(ROWS.medium)
        const large = at(ROWS.large)
        if (!tiny || !medium || !large) continue
        expect([
          algorithm,
          f.key,
          tiny.max <= medium.max && medium.max <= large.max,
        ]).toEqual([algorithm, f.key, true])
      }
    }
  })
})

describe('MODEL-FLOW-024: describeSizing tells the truth in every state', () => {
  it('says nothing is sized yet, and how to size it, before a split is applied', () => {
    const line = describeSizing('xgboost', {})
    expect(line).toContain('not your dataset')
    expect(line).toContain('apply the train/test split')
    expect(line).not.toContain('Sized to')
  })

  it('names the row count, its tier and the hourly reading when the ranges are sized', () => {
    // 8,350 rows hold 32 distinct lab values; the copy speaks in rows only.
    const small = describeSizing('xgboost', {
      distinctLabelled: 32,
      rows: 8_350,
    })
    expect(small).toContain('Sized to your 8,350 rows')
    expect(small).toContain('small dataset')
    expect(small).toContain('4,380-8,759 rows, 6-12 months of hourly data')
    expect(small).not.toContain('distinct')

    const tiny = describeSizing('xgboost', { rows: 2_000 })
    expect(tiny).toContain('very small dataset')
    expect(tiny).toContain('under 4,380 rows, under 6 months of hourly data')

    const large = describeSizing('xgboost', { rows: 30_000 })
    expect(large).toContain('large dataset')
    expect(large).toContain('26,280+ rows, over 3 years of hourly data')
  })

  it('says the general ranges apply for the mid-size tier, where nothing is adjusted', () => {
    const line = describeSizing('xgboost', { rows: 12_000 })
    expect(line).toContain('Your 12,000 rows fall in the mid-size tier')
    expect(line).toContain('8,760-26,279 rows, 1-3 years of hourly data')
    expect(line).not.toContain('Sized to')
  })

  it('never claims sizing for an algorithm no size changes', () => {
    for (const algorithm of ['ols', 'grp', 'pls'] as const) {
      const line = describeSizing(algorithm, { rows: ROWS.tiny })
      expect(line).toContain('no size-dependent range')
      expect(line).not.toContain('Sized to')
    }
  })

  it('names the rows cap for lstm/gru only when it binds', () => {
    expect(describeSizing('lstm', { rows: 400 })).toContain(
      'capped at an eighth of your 400 rows',
    )
    expect(describeSizing('lstm', { rows: 15_441 })).not.toContain('capped')
  })

  it('always says the ranges are priors, not measured optima', () => {
    for (const algorithm of ALGORITHMS) {
      for (const size of [
        {},
        { distinctLabelled: 32, rows: 400 },
        { rows: ROWS.large },
      ]) {
        expect(describeSizing(algorithm, size)).toContain('not measured optima')
      }
    }
  })
})

describe('MODEL-FLOW-024: datasetSizeFrom', () => {
  it('reads both figures off the split stats when they resolved', () => {
    expect(
      datasetSizeFrom(
        { distinct_labelled_values: 32, source_rows: 8_350 },
        9_000,
      ),
    ).toEqual({ distinctLabelled: 32, rows: 8_350, features: null })
  })

  it('falls back to the dataset row count for rows ONLY, never for distinct values', () => {
    // The split-stats fetch waits for Apply and is never made while lstm/gru
    // is selected, so the dataset's own count stands in for rows. Distinct
    // values cannot be faked from a row count and are left null.
    expect(datasetSizeFrom(null, 400)).toEqual({
      distinctLabelled: null,
      rows: 400,
      features: null,
    })
    expect(datasetSizeFrom(undefined, 400).distinctLabelled).toBeNull()
  })

  it('reports nothing known when there is neither', () => {
    expect(datasetSizeFrom(null)).toEqual({
      distinctLabelled: null,
      rows: null,
      features: null,
    })
    expect(datasetSizeFrom(null, 0)).toEqual({
      distinctLabelled: null,
      rows: null,
      features: null,
    })
  })

  it('a row-count fallback sizes a capacity band exactly as the split-stats rows do', () => {
    // The tier keys on rows, so the dataset's own count must size the form
    // before Apply the same way `source_rows` does after it — the job sends
    // this same figure, and the two must not disagree.
    const f = field('xgboost', 'n_estimators')
    const fromFallback = suggestedRangeFor(
      'xgboost',
      f,
      datasetSizeFrom(null, ROWS.tiny),
    )
    const fromStats = suggestedRangeFor(
      'xgboost',
      f,
      datasetSizeFrom({
        distinct_labelled_values: 900,
        source_rows: ROWS.tiny,
      }),
    )
    expect(fromFallback).toEqual(fromStats)
    expect(fromFallback).not.toBe(
      (f as { suggestedRange: unknown }).suggestedRange,
    )
  })
})

describe('MODEL-FLOW-024: pls n_components follows the feature count', () => {
  const comp = HYPERPARAMS.pls.find(f => f.key === 'n_components')!

  it('is the general band, by reference, when the feature count is unknown or ample', () => {
    const general = (comp as { suggestedRange: unknown }).suggestedRange
    expect(suggestedRangeFor('pls', comp)).toBe(general)
    expect(suggestedRangeFor('pls', comp, { features: null })).toBe(general)
    expect(suggestedRangeFor('pls', comp, { features: 6 })).toBe(general)
    expect(suggestedRangeFor('pls', comp, { features: 40 })).toBe(general)
  })

  it.each([1, 2, 3, 4, 5])('caps the ceiling at %d features', features => {
    const range = suggestedRangeFor('pls', comp, { features })
    expect(range?.min).toBe(1)
    expect(range?.max).toBe(features)
  })

  it('applies at every size tier — it is not a size prior', () => {
    for (const rows of Object.values(ROWS)) {
      expect(suggestedRangeFor('pls', comp, { rows, features: 3 })?.max).toBe(3)
    }
  })

  it('leaves pls’s other band alone', () => {
    const iter = HYPERPARAMS.pls.find(f => f.key === 'max_iter')!
    expect(suggestedRangeFor('pls', iter, { features: 2 })).toBe(
      (iter as { suggestedRange: unknown }).suggestedRange,
    )
  })

  it('reports itself as sized only when the cap actually binds', () => {
    expect(isSizedFor('pls', { features: 3 })).toBe(true)
    expect(isSizedFor('pls', { features: 12 })).toBe(false)
    expect(isSizedFor('pls', { rows: ROWS.tiny })).toBe(false)
  })

  it('says so in words, and never claims tier sizing', () => {
    const line = describeSizing('pls', { rows: ROWS.tiny, features: 3 })
    expect(line).toContain('capped at your 3 features')
    expect(line).not.toContain('Sized to')
  })

  it('says an algorithm no size changes needs no split, before or after one is applied', () => {
    for (const algorithm of ['ols', 'grp', 'pls'] as const) {
      const line = describeSizing(algorithm, {})
      expect(line).toContain('no size-dependent range')
      expect(line).not.toContain('apply the train/test split')
    }
  })

  it('datasetSizeFrom carries the feature count, and drops a nonsense one', () => {
    expect(datasetSizeFrom(null, null, 7).features).toBe(7)
    expect(datasetSizeFrom(null, null, 0).features).toBeNull()
    expect(datasetSizeFrom(null, null, null).features).toBeNull()
  })
})
