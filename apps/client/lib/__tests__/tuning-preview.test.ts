import { describe, it, expect } from 'vitest'
import { ALGORITHMS, type Algorithm } from '@/store/model-pipeline'
import {
  HYPERPARAMS,
  defaultHyperparams,
  type HyperparamField,
} from '@/lib/training-config'
import {
  SIZE_TIER_LOWER_BOUNDS,
  type DatasetSize,
} from '@/lib/hyperparam-ranges'
import {
  baseHyperparamsFor,
  formatVariantValue,
  previewVariants,
  variantColumns,
  type TuningVariant,
} from '@/lib/tuning-preview'
// The backend module itself, as the sibling agreement test does: the preview is
// only worth having if it can never disagree with what a job actually builds.
import {
  TUNE_VARIANTS_PER_JOB,
  tuningCandidatesFor,
  tuningVariantsFor,
} from '../../../backend/src/lib/tuning-grid'

const CAP = TUNE_VARIANTS_PER_JOB

/** One dataset size per tier, plus the two figures only lstm/gru and pls read. */
const SIZES: (DatasetSize | undefined)[] = [
  undefined,
  { rows: Math.floor(SIZE_TIER_LOWER_BOUNDS.small / 2) },
  { rows: SIZE_TIER_LOWER_BOUNDS.small },
  { rows: SIZE_TIER_LOWER_BOUNDS.medium },
  { rows: SIZE_TIER_LOWER_BOUNDS.large * 2 },
  { rows: 400 },
  { rows: SIZE_TIER_LOWER_BOUNDS.medium, features: 3 },
]

const gridFor = (algorithm: Algorithm, size?: DatasetSize): TuningVariant[] =>
  tuningVariantsFor(algorithm, size)

function field(algorithm: Algorithm, key: string): HyperparamField {
  const found = HYPERPARAMS[algorithm].find(f => f.key === key)
  if (!found) throw new Error(`${algorithm}.${key} is not a form field`)
  return found
}

describe('MODEL-FLOW-025: baseHyperparamsFor is the record the job sends as its base', () => {
  const flat = { n_estimators: 500 }
  const perAlgorithm = { svm: { C: 2 } }

  it('answers with the flat record for the PRIMARY algorithm, laid over its defaults', () => {
    expect(baseHyperparamsFor('xgboost', ['xgboost', 'svm'], flat, {})).toEqual(
      { ...defaultHyperparams('xgboost'), ...flat },
    )
  })

  it('fills a PARTIAL record with defaults, so a search can see it equals a variant (T05)', () => {
    // One field edited, the rest blank: effective values equal the grid's
    // variant, and the base must say so or the search re-runs that setting.
    // A multi-field algorithm, so "partial" really is partial: the variant is
    // the defaults with ONE field changed, and the user edited only that field.
    const defaults = defaultHyperparams('xgboost')
    expect(Object.keys(defaults).length).toBeGreaterThan(1)
    const target = { ...defaults, n_estimators: 777 }
    const grid: TuningVariant[] = [target, { ...defaults, n_estimators: 50 }]
    const partial = { n_estimators: 777 }

    // Before T05 the partial record went out as-is and covered nothing.
    expect(previewVariants('xgboost', grid, partial, CAP).skipped).toBe(0)

    const base = baseHyperparamsFor('xgboost', ['xgboost'], partial, {})
    expect(previewVariants('xgboost', grid, base, CAP).shown).toEqual([grid[1]])
  })

  it('keeps a key the catalogue does not know', () => {
    expect(
      baseHyperparamsFor('ridge', ['ridge'], { mystery: 1 }, {}),
    ).toHaveProperty('mystery', 1)
  })

  it('falls back to the primary’s full defaults when the flat record is empty', () => {
    expect(baseHyperparamsFor('xgboost', ['xgboost', 'svm'], {}, {})).toEqual(
      defaultHyperparams('xgboost'),
    )
  })

  it('ignores a per-algorithm entry for the primary — the flat record answers for it alone', () => {
    expect(
      baseHyperparamsFor('svm', ['svm', 'ridge'], {}, { svm: { C: 2 } }),
    ).toEqual(defaultHyperparams('svm'))
  })

  it('answers with the per-algorithm entry for a non-primary algorithm', () => {
    expect(
      baseHyperparamsFor('svm', ['xgboost', 'svm'], flat, perAlgorithm),
    ).toEqual({ ...defaultHyperparams('svm'), ...perAlgorithm.svm })
  })

  it('falls back to full defaults — not {} — for an untouched non-primary algorithm', () => {
    // The card's own prop is {} here; the job sends defaults. They differ.
    expect(baseHyperparamsFor('svm', ['xgboost', 'svm'], flat, {})).toEqual(
      defaultHyperparams('svm'),
    )
  })
})

describe('MODEL-FLOW-025: previewVariants', () => {
  const variants: TuningVariant[] = [
    { alpha: 3 },
    { alpha: 10 },
    { alpha: 30 },
    { alpha: 100 },
  ]

  it('shows every variant when nothing in the base equals one', () => {
    expect(previewVariants('ridge', variants, { alpha: 1 }, CAP)).toEqual({
      shown: variants,
      skipped: 0,
    })
  })

  it('drops the variant a tabular base equals exactly, keeps the order, and counts it', () => {
    const result = previewVariants('ridge', variants, { alpha: 10 }, CAP)
    expect(result.shown).toEqual([{ alpha: 3 }, { alpha: 30 }, { alpha: 100 }])
    expect(result.skipped).toBe(1)
  })

  it('drops nothing for a base carrying a key no variant names — whole-record equality, as the backend pins', () => {
    const result = previewVariants(
      'ridge',
      variants,
      { alpha: 10, fit_intercept: true },
      CAP,
    )
    expect(result.shown).toEqual(variants)
    expect(result.skipped).toBe(0)
  })

  it('drops nothing for a partial base (some keys edited, the rest left to default)', () => {
    const multi: TuningVariant[] = [
      { n_estimators: 100, max_depth: 3 },
      { n_estimators: 300, max_depth: 6 },
    ]
    expect(
      previewVariants('xgboost', multi, { n_estimators: 100 }, CAP).shown,
    ).toEqual(multi)
  })

  it('caps the list at the job’s per-job maximum', () => {
    const result = previewVariants('ridge', variants, { alpha: 1 }, 2)
    expect(result.shown).toEqual([{ alpha: 3 }, { alpha: 10 }])
  })

  it('is empty, with nothing skipped, for an empty grid', () => {
    expect(previewVariants('ridge', [], { alpha: 1 }, CAP)).toEqual({
      shown: [],
      skipped: 0,
    })
  })

  it('does not mutate what it is given', () => {
    const base = { alpha: 10 }
    const frozen = variants.map(v => ({ ...v }))
    previewVariants('ridge', variants, base, CAP)
    expect(variants).toEqual(frozen)
    expect(base).toEqual({ alpha: 10 })
  })

  describe('lstm/gru', () => {
    const seq: TuningVariant[] = [
      { epochs: 30, hidden_size: 32, batch_size: 16 },
      { epochs: 50, hidden_size: 64, batch_size: 32 },
    ]

    it('compares on the variant’s own keys, so a base with extra keys still covers it', () => {
      const base = {
        epochs: 30,
        hidden_size: 32,
        batch_size: 16,
        sequence_length: 48,
      }
      expect(previewVariants('lstm', seq, base, CAP).skipped).toBe(1)
    })

    it('carries the base’s numeric sequence_length onto every shown variant', () => {
      const { shown } = previewVariants(
        'gru',
        seq,
        { epochs: 1, sequence_length: 48 },
        CAP,
      )
      expect(shown.map(v => v.sequence_length)).toEqual([48, 48])
    })

    it('carries nothing when the base has no numeric sequence_length', () => {
      expect(previewVariants('lstm', seq, { epochs: 1 }, CAP).shown).toEqual(
        seq,
      )
      expect(
        previewVariants('lstm', seq, { sequence_length: 'x' }, CAP).shown,
      ).toEqual(seq)
    })

    it('never carries sequence_length for a tabular algorithm', () => {
      const { shown } = previewVariants(
        'ridge',
        [{ alpha: 3 }],
        { alpha: 1, sequence_length: 48 },
        CAP,
      )
      expect(shown).toEqual([{ alpha: 3 }])
    })
  })
})

/**
 * THE POINT OF THE FEATURE. The preview must show exactly what a job would run,
 * and the two are separate implementations (the backend cannot be imported into
 * the client bundle), so this imports the backend and compares them across every
 * algorithm, every size tier and a spread of base records.
 */
describe('MODEL-FLOW-025: the preview agrees with the backend’s tuningCandidatesFor', () => {
  function basesFor(algorithm: Algorithm, grid: TuningVariant[]) {
    const carried = algorithm === 'lstm' || algorithm === 'gru'
    const withSeq = (v: TuningVariant): TuningVariant =>
      carried ? { ...v, sequence_length: 48 } : v
    const first = grid[0]
    return [
      // What the job sends when the user has touched nothing.
      baseHyperparamsFor(algorithm, [algorithm], {}, {}),
      {},
      // What it sends once every field equals one grid variant.
      ...grid.map(withSeq),
      // A variant plus a key it does not vary, and a partial edit.
      ...(first ? [{ ...withSeq(first), extra_key: 1 }] : []),
      ...(first
        ? [{ [Object.keys(first)[0]!]: Object.values(first)[0]! }]
        : []),
    ] as TuningVariant[]
  }

  let excludingCases = 0
  let cases = 0

  for (const algorithm of ALGORITHMS) {
    for (const size of SIZES) {
      const grid = gridFor(algorithm, size)
      if (grid.length === 0) continue
      const label = `${algorithm} @ ${JSON.stringify(size ?? {})}`

      it(`${label}: same list, same order, for every base`, () => {
        // The count of skipped variants below is only comparable while the grid
        // fits inside the cap; if it ever outgrows it this must be revisited.
        expect(grid.length).toBeLessThanOrEqual(CAP)
        for (const base of basesFor(algorithm, grid)) {
          const preview = previewVariants(algorithm, grid, base, CAP)
          const backend = tuningCandidatesFor(algorithm, base, size)
          expect(
            preview.shown,
            `${label} with base ${JSON.stringify(base)}`,
          ).toEqual(backend)
          expect(preview.skipped).toBe(grid.length - backend.length)
          cases += 1
          if (preview.skipped > 0) excludingCases += 1
        }
      })
    }
  }

  it('is not vacuous: exclusion fires for tabular and for sequence algorithms', () => {
    // Runs after the loops above, so both counters are populated.
    expect(cases).toBeGreaterThan(200)
    expect(excludingCases).toBeGreaterThan(50)

    const largeRows = SIZE_TIER_LOWER_BOUNDS.large * 2
    const svm = gridFor('svm', { rows: largeRows })
    // A real, non-obvious case the job hits with NO user edit: at the large
    // tier SVM's default record IS one of the variants.
    expect(
      previewVariants(
        'svm',
        svm,
        baseHyperparamsFor('svm', ['svm'], {}, {}),
        CAP,
      ).skipped,
    ).toBe(1)
    // ...and the card's own {} would have missed it.
    expect(previewVariants('svm', svm, {}, CAP).skipped).toBe(0)

    const lstm = gridFor('lstm')
    expect(
      previewVariants('lstm', lstm, { ...lstm[0]!, sequence_length: 48 }, CAP)
        .skipped,
    ).toBe(1)
  })
})

/**
 * The variant table reads a missing key as `null`, and `null` on an
 * unlimited-capable field prints as "unlimited". That is only honest while no
 * grid is RAGGED: a variant that merely omitted `max_depth` would otherwise
 * render as unlimited beside one that sets it to null. The grids the backend
 * serves are uniform today; this is what keeps them so.
 */
describe('MODEL-FLOW-025: no served grid is ragged', () => {
  for (const algorithm of ALGORITHMS) {
    for (const size of SIZES) {
      const grid = gridFor(algorithm, size)
      if (grid.length < 2) continue
      it(`${algorithm} @ ${JSON.stringify(size ?? {})}: every variant names the same keys`, () => {
        const keySets = grid.map(v => Object.keys(v).sort().join(','))
        expect(new Set(keySets).size).toBe(1)
      })
    }
  }
})

describe('MODEL-FLOW-025: variantColumns', () => {
  it('lists only the keys the grid varies, in the form’s own field order, with the form’s labels', () => {
    const grid = gridFor('xgboost')
    const keys = new Set(grid.flatMap(Object.keys))
    expect(variantColumns('xgboost', grid)).toEqual(
      HYPERPARAMS.xgboost
        .filter(f => keys.has(f.key))
        .map(f => ({ key: f.key, label: f.label })),
    )
  })

  it('never lists sequence_length: it is carried, not tuned', () => {
    const keys = variantColumns('lstm', gridFor('lstm')).map(c => c.key)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).not.toContain('sequence_length')
  })

  it('appends a key the form does not know, labelled by the key itself', () => {
    const cols = variantColumns('ridge', [{ alpha: 3, mystery: 1 }])
    expect(cols.at(-1)).toEqual({ key: 'mystery', label: 'mystery' })
  })

  it('is empty for an empty grid', () => {
    expect(variantColumns('ridge', [])).toEqual([])
  })
})

describe('MODEL-FLOW-025: formatVariantValue', () => {
  it('prints numbers as themselves', () => {
    expect(formatVariantValue(field('ridge', 'alpha'), 0.001)).toBe('0.001')
    expect(formatVariantValue(field('ridge', 'alpha'), 100)).toBe('100')
  })

  it('reads null on an unlimited-capable field as "unlimited"', () => {
    expect(formatVariantValue(field('random_forest', 'max_depth'), null)).toBe(
      'unlimited',
    )
  })

  it('reads a select value as its option label', () => {
    const kernel = field('svm', 'kernel')
    if (kernel.kind !== 'select') throw new Error('svm.kernel is not a select')
    const option = kernel.options[0]!
    expect(formatVariantValue(kernel, option.value)).toBe(option.label)
  })

  it('reads a checkbox as on/off', () => {
    const box = field('ols', 'fit_intercept')
    expect(formatVariantValue(box, true)).toBe('on')
    expect(formatVariantValue(box, false)).toBe('off')
  })

  it('falls back to the raw value for a field the form does not know', () => {
    expect(formatVariantValue(undefined, 'gbdt')).toBe('gbdt')
    expect(formatVariantValue(undefined, 7)).toBe('7')
    expect(formatVariantValue(undefined, null)).toBe('—')
  })
})
