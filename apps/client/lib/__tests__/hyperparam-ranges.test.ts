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

describe('MODEL-FLOW-024: sizeTierFor', () => {
  it.each([
    [0, 'tiny'],
    [49, 'tiny'],
    [SIZE_TIER_LOWER_BOUNDS.small, 'small'],
    [149, 'small'],
    [SIZE_TIER_LOWER_BOUNDS.medium, 'medium'],
    [499, 'medium'],
    [SIZE_TIER_LOWER_BOUNDS.large, 'large'],
    [46_070, 'large'],
  ] as [number, SizeTier][])('%d distinct labelled values is %s', (n, tier) => {
    expect(sizeTierFor(n)).toBe(tier)
  })

  it('resolves an unknown figure to medium, never to a tighter tier', () => {
    expect(sizeTierFor(null)).toBe('medium')
    expect(sizeTierFor(undefined)).toBe('medium')
    expect(sizeTierFor(Number.NaN)).toBe('medium')
  })

  it('puts every dataset this system has measured (19, 32, 59, 97) in a low tier, whatever its row count', () => {
    // The point of keying on distinct values: 8,350 rows hold 32 of them, so
    // the row count must not be able to move the tier at all.
    expect([19, 32, 59, 97].map(n => sizeTierFor(n))).toEqual([
      'tiny',
      'tiny',
      'small',
      'small',
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
        expect(suggestedRangeFor(algorithm, f, { distinctLabelled: 300 })).toBe(
          f.suggestedRange,
        )
      }
    }
  })

  it('shrinks a capacity band for a tiny dataset and widens it for a large one', () => {
    const f = field('xgboost', 'n_estimators')
    const tiny = suggestedRangeFor('xgboost', f, { distinctLabelled: 32 })
    const medium = suggestedRangeFor('xgboost', f, { distinctLabelled: 300 })
    const large = suggestedRangeFor('xgboost', f, { distinctLabelled: 900 })
    expect(tiny?.max).toBeLessThan(medium!.max)
    expect(large?.max).toBeGreaterThan(medium!.max)
    // What the parameter DOES does not change with size.
    expect(tiny?.note).toBe(medium?.note)
  })

  it('does not read the row count for a capacity band', () => {
    // 8,350 rows holding 32 distinct values is `tiny`: rows must not widen it.
    const f = field('xgboost', 'n_estimators')
    expect(
      suggestedRangeFor('xgboost', f, { distinctLabelled: 32, rows: 8_350 }),
    ).toEqual(suggestedRangeFor('xgboost', f, { distinctLabelled: 32 }))
  })

  it('leaves algorithms with no size prior on their own band in every tier', () => {
    for (const algorithm of ['ols', 'grp', 'pls'] as const) {
      for (const f of HYPERPARAMS[algorithm]) {
        if (f.kind !== 'number' && f.kind !== 'nullable-number') continue
        for (const distinctLabelled of [10, 100, 300, 900]) {
          expect(suggestedRangeFor(algorithm, f, { distinctLabelled })).toBe(
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
    expect(isSizedFor('xgboost', { distinctLabelled: 300 })).toBe(false)
    expect(isSizedFor('xgboost', { distinctLabelled: 32 })).toBe(true)
    expect(isSizedFor('pls', { distinctLabelled: 32 })).toBe(false)
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
        const at = (n: number) =>
          suggestedRangeFor(algorithm, f, { distinctLabelled: n })
        const tiny = at(10)
        const medium = at(300)
        const large = at(900)
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

  it('names the distinct-value count and disowns the row count when the ranges are sized', () => {
    const line = describeSizing('xgboost', {
      distinctLabelled: 32,
      rows: 8_350,
    })
    expect(line).toContain('Sized to your 32 distinct lab values')
    expect(line).toContain('very small dataset')
    expect(line).toContain('not your 8,350 rows')
  })

  it('says the general ranges apply for the mid-size tier, where nothing is adjusted', () => {
    const line = describeSizing('xgboost', { distinctLabelled: 300 })
    expect(line).toContain('mid-size tier')
    expect(line).not.toContain('Sized to')
  })

  it('never claims sizing for an algorithm no size changes', () => {
    for (const algorithm of ['ols', 'grp', 'pls'] as const) {
      const line = describeSizing(algorithm, { distinctLabelled: 32 })
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
        { distinctLabelled: 900 },
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
    ).toEqual({ distinctLabelled: 32, rows: 8_350 })
  })

  it('falls back to the dataset row count for rows ONLY, never for distinct values', () => {
    // The split-stats fetch is never made while lstm/gru is selected, so
    // without this the batch cap could never apply to the algorithms it exists
    // for. Distinct values cannot be faked from a row count — that is exactly
    // the confusion the feature exists to avoid.
    expect(datasetSizeFrom(null, 400)).toEqual({
      distinctLabelled: null,
      rows: 400,
    })
    expect(datasetSizeFrom(undefined, 400).distinctLabelled).toBeNull()
  })

  it('reports nothing known when there is neither', () => {
    expect(datasetSizeFrom(null)).toEqual({
      distinctLabelled: null,
      rows: null,
    })
    expect(datasetSizeFrom(null, 0)).toEqual({
      distinctLabelled: null,
      rows: null,
    })
  })

  it('a row-count fallback cannot size a capacity band', () => {
    const f = HYPERPARAMS.xgboost.find(x => x.key === 'n_estimators')!
    const size = datasetSizeFrom(null, 50)
    expect(suggestedRangeFor('xgboost', f, size)).toBe(
      (f as { suggestedRange: unknown }).suggestedRange,
    )
  })
})
