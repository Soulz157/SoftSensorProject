import { describe, it, expect } from 'vitest'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import {
  SIZE_TIER_LOWER_BOUNDS,
  batchSizeBand,
  sizeTierFor,
  suggestedRangeFor,
  type SizeTier,
} from '@/lib/hyperparam-ranges'
import { ALGORITHMS, type Algorithm } from '@/store/model-pipeline'
// The backend module itself, not a copy and not a regex over its source: it is
// dependency-free, so vitest loads it as-is, and this test sees the exact data
// a Find Best Parameters job would run. (`readGrid()` used to bracket-scan the
// file's text; that broke the moment the table gained tier overrides, and
// reading the source guarded nothing an import does not.)
import {
  SIZE_TIER_LOWER_BOUNDS as BACKEND_TIER_BOUNDS,
  TUNING_GRID,
  batchSizeBand as backendBatchSizeBand,
  sizeTierFor as backendSizeTierFor,
  tuningVariantsFor,
} from '../../../backend/src/lib/tuning-grid'

/**
 * MODEL-FLOW-020-T05 (AC7) and -T06, both resting on this feature's finding
 * 5: `HYPERPARAMS` here and `TUNING_GRID` in the backend are two sources of
 * truth for one thing, and T01(d) found the disagreement is already
 * REACHABLE — a sweep sends this file's `defaultHyperparams` as its phase-1
 * candidates while `advanceJobForRun` builds phase 2 from the backend grid,
 * inside one SWEEP_THEN_TUNE job. They agree today only because
 * MODEL-FLOW-012-T01 checked by hand and MODEL-FLOW-020-T01(b) checked again.
 * Nothing enforced it until this file.
 *
 * A GUARD THAT READS THE REAL TABLE, not a hand-copied one — copying the
 * grid's values in here would produce a THIRD source of truth, and this test
 * would then pass forever while the real two drifted apart.
 *
 * MODEL-FLOW-024 EXTENDS THAT FROM ONE TABLE TO FOUR. AC7 wanted "the
 * suggested range contains every value the DERIVED grid can produce for that
 * algorithm at that size"; MODEL-FLOW-020-T03 closed as a no-op so there was
 * no derived grid and no "at that size". There is one now: the backend picks
 * a tier's variants from the dataset's distinct-labelled-value count and the
 * form picks that tier's band, and this file is what keeps the two on the
 * same side of every boundary.
 */
const grid = TUNING_GRID as Record<
  string,
  Record<string, string | number | boolean | null>[]
>

/** The numeric values a grid names, per algorithm and key. Strings
 *  (kernel/boosting_type) and `null` (random_forest's unlimited depth) are not
 *  points on a numeric band — a select has no range, and "unlimited" is a
 *  separate choice the toggle already explains. */
function numericValues(
  variants: Record<string, string | number | boolean | null>[],
): Record<string, number[]> {
  const perKey: Record<string, number[]> = {}
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant)) {
      if (typeof value !== 'number') continue
      ;(perKey[key] ??= []).push(value)
    }
  }
  return perKey
}

/** The two field kinds that carry a numeric band — a type PREDICATE, not a
 *  bare filter: `suggestedRange` lives only on these members, so without the
 *  narrowing every access below is an error on the union as a whole. */
type NumericField = Extract<
  HyperparamField,
  { kind: 'number' | 'nullable-number' }
>

function numericFields(algorithm: Algorithm): NumericField[] {
  return (HYPERPARAMS[algorithm] ?? []).filter(
    (f): f is NumericField =>
      f.kind === 'number' || f.kind === 'nullable-number',
  )
}

describe('MODEL-FLOW-020-T05: the suggested range agrees with the real tuning grid', () => {
  it('reads a grid that actually loaded — the guard is worthless if the import silently yielded nothing', () => {
    // Without this, an emptied or renamed table would make every containment
    // assertion below pass vacuously.
    expect(Object.keys(grid).length).toBeGreaterThanOrEqual(12)
    expect(numericValues(grid['ridge'] ?? [])['alpha']).toEqual(
      expect.arrayContaining([0.01, 0.1, 10, 100]),
    )
  })

  for (const algorithm of ALGORITHMS) {
    const perKey = numericValues(grid[algorithm] ?? [])
    if (Object.keys(perKey).length === 0) continue // ols: no numeric knob

    it(`${algorithm}: every grid value falls inside the suggested range`, () => {
      for (const field of numericFields(algorithm)) {
        const values = perKey[field.key]
        const range = field.suggestedRange
        if (!values || !range) continue
        for (const value of values) {
          expect(
            value,
            `${algorithm}.${field.key}: the tuning phase tries ${value}, ` +
              `outside the suggested ${range.min}-${range.max} the form shows`,
          ).toBeGreaterThanOrEqual(range.min)
          expect(value).toBeLessThanOrEqual(range.max)
        }
      }
    })
  }

  it('every numeric field carries a range, and it contains that field’s own default', () => {
    // A form cannot ship a default it simultaneously calls out of range — and
    // a numeric field with no band at all is the silent gap this closes.
    for (const algorithm of ALGORITHMS) {
      for (const field of numericFields(algorithm)) {
        const range = field.suggestedRange
        expect(
          range,
          `${algorithm}.${field.key} has no suggestedRange`,
        ).toBeDefined()
        if (!range) continue
        expect(range.min).toBeLessThan(range.max)
        expect(range.note.length).toBeGreaterThan(0)
        // A `null` default is random_forest's "unlimited", not a point on the band.
        if (typeof field.defaultValue === 'number') {
          expect(
            field.defaultValue,
            `${algorithm}.${field.key}: default ${field.defaultValue} sits outside its own suggested range`,
          ).toBeGreaterThanOrEqual(range.min)
          expect(field.defaultValue).toBeLessThanOrEqual(range.max)
        }
      }
    }
  })

  /**
   * MODEL-FLOW-020-T05's own explicit exclusion. Seed reaches `random_state`
   * on only 6 of 10 estimators and lossFunction reaches the trainer not at
   * all (MODEL-FLOW-012-T01/T05) — both already carry per-algorithm honesty
   * labels, and a "suggested range" beside either would undo exactly that.
   * Structurally excluded rather than merely un-annotated: neither is a
   * member of HYPERPARAMS in the first place.
   */
  it('seed and loss function are not hyperparameter fields, so they can gain no range', () => {
    for (const algorithm of ALGORITHMS) {
      const keys = (HYPERPARAMS[algorithm] ?? []).map(f => f.key)
      expect(keys).not.toContain('seed')
      expect(keys).not.toContain('lossFunction')
      expect(keys).not.toContain('loss_function')
    }
  })
})

/** Every variant an algorithm can be tuned over at ANY size, medium included. */
function everyVariant(algorithm: Algorithm) {
  return [10, 100, 300, 900].flatMap(distinctLabelled =>
    tuningVariantsFor(algorithm, { distinctLabelled }),
  )
}

/**
 * MODEL-FLOW-020-T06. The sweep's phase-1 candidates are this file's own
 * defaults (`defaultHyperparams`, use-model-training.ts) while phase 2 comes
 * from the backend grid — so the two tables must at minimum name the SAME
 * KEYS per algorithm, or a tuning phase would vary a knob the form never
 * showed.
 *
 * This is the enforcement T01(d) found missing. Since MODEL-FLOW-024 it holds
 * for every tier's variants, not just the medium table.
 */
describe('MODEL-FLOW-020-T06: HYPERPARAMS and TUNING_GRID name the same keys', () => {
  for (const algorithm of ALGORITHMS) {
    if (!grid[algorithm]) continue

    it(`${algorithm}: every grid key, in every tier, is a field the form actually shows`, () => {
      const formKeys = new Set((HYPERPARAMS[algorithm] ?? []).map(f => f.key))
      const gridKeys = new Set(everyVariant(algorithm).flatMap(Object.keys))
      for (const key of gridKeys) {
        expect(
          formKeys.has(key),
          `TUNING_GRID varies "${key}" for ${algorithm}, but the form has no such field — ` +
            'the tuning phase would change something the user was never shown.',
        ).toBe(true)
      }
    })
  }

  it('lstm and gru have a grid, and it never names sequence_length', () => {
    // MODEL-FLOW-024 reverses this test's old assertion ("no grid entry — they
    // never reach build_model"), which stopped being true when
    // MODEL-FLOW-009-T04 let them train. sequence_length is a form field but
    // feeds windowing, not build_model, so it belongs to the base run and is
    // carried across by tuningCandidatesFor — never varied.
    for (const algorithm of ['lstm', 'gru'] as const) {
      expect(grid[algorithm]?.length).toBeGreaterThan(0)
      const keys = new Set(everyVariant(algorithm).flatMap(Object.keys))
      expect(keys).not.toContain('sequence_length')
    }
  })
})

/**
 * MODEL-FLOW-024. The heart of the feature: the backend chooses variants by
 * size tier, the form chooses a band by size tier, and they must never
 * disagree. Each tier is exercised at a representative figure AND at both
 * sides of every boundary, so an off-by-one in either module's edges fails
 * here rather than in front of a user.
 */
const TIER_FIGURES: [SizeTier, number][] = [
  ['tiny', 0],
  ['tiny', 32],
  ['tiny', 49],
  ['small', 50],
  ['small', 100],
  ['small', 149],
  ['medium', 150],
  ['medium', 300],
  ['medium', 499],
  ['large', 500],
  ['large', 900],
  ['large', 46_070],
]

describe('MODEL-FLOW-024: both sides agree on which tier a figure belongs to', () => {
  it('declare the same tier edges', () => {
    expect(SIZE_TIER_LOWER_BOUNDS).toEqual(BACKEND_TIER_BOUNDS)
  })

  it.each(TIER_FIGURES)('%s: %d distinct labelled values', (tier, n) => {
    expect(sizeTierFor(n)).toBe(tier)
    expect(backendSizeTierFor(n)).toBe(tier)
  })

  it('agree on an unknown figure', () => {
    for (const n of [null, undefined, Number.NaN]) {
      expect(sizeTierFor(n)).toBe(backendSizeTierFor(n))
    }
  })

  it('agree on the LSTM/GRU batch band at every row count that matters', () => {
    for (const rows of [
      null,
      undefined,
      0,
      1,
      8,
      63,
      64,
      100,
      400,
      1_023,
      1_024,
      8_350,
      15_441,
    ]) {
      expect(batchSizeBand(rows)).toEqual(backendBatchSizeBand(rows))
    }
  })
})

describe('MODEL-FLOW-024: every variant a tier can try sits inside that tier’s band', () => {
  for (const algorithm of ALGORITHMS) {
    if (!grid[algorithm]) continue
    for (const [tier, n] of TIER_FIGURES) {
      it(`${algorithm} @ ${tier} (${n}): every tried value is inside the band the form shows`, () => {
        const size = { distinctLabelled: n }
        const perKey = numericValues(tuningVariantsFor(algorithm, size))
        for (const field of numericFields(algorithm)) {
          const values = perKey[field.key]
          const range = suggestedRangeFor(algorithm, field, size)
          if (!values || !range) continue
          for (const value of values) {
            expect(
              value,
              `${algorithm}.${field.key} @ ${tier}: the tuning phase tries ${value}, ` +
                `outside the ${range.min}-${range.max} the form shows for ${n} distinct labelled values`,
            ).toBeGreaterThanOrEqual(range.min)
            expect(value).toBeLessThanOrEqual(range.max)
          }
        }
      })
    }
  }

  it('lstm/gru batch_size sits inside the rows band at every row count', () => {
    for (const algorithm of ['lstm', 'gru'] as const) {
      const batch = numericFields(algorithm).find(f => f.key === 'batch_size')!
      for (const rows of [0, 20, 64, 100, 400, 1_023, 1_024, 8_350, 15_441]) {
        const range = suggestedRangeFor(algorithm, batch, { rows })!
        for (const variant of tuningVariantsFor(algorithm, { rows })) {
          expect(Number(variant.batch_size)).toBeGreaterThanOrEqual(range.min)
          expect(Number(variant.batch_size)).toBeLessThanOrEqual(range.max)
        }
      }
    }
  })

  it('lstm/gru epochs and hidden_size stay inside their fixed bands whatever the size', () => {
    // Only batch_size is sized for a sequence model — a claim the form makes,
    // so it is asserted rather than assumed.
    for (const algorithm of ['lstm', 'gru'] as const) {
      for (const key of ['epochs', 'hidden_size']) {
        const field = numericFields(algorithm).find(f => f.key === key)!
        const range = field.suggestedRange!
        for (const variant of tuningVariantsFor(algorithm, {
          distinctLabelled: 20,
          rows: 100,
        })) {
          expect(Number(variant[key])).toBeGreaterThanOrEqual(range.min)
          expect(Number(variant[key])).toBeLessThanOrEqual(range.max)
        }
      }
    }
  })

  it('a tier actually differs from medium for the algorithms with a capacity dial', () => {
    // Vacuity guard: if the override tables emptied, every containment test
    // above would still pass by comparing the medium table to itself.
    for (const algorithm of [
      'ridge',
      'hist_gradient_boosting',
      'svm',
      'mlp',
      'random_forest',
      'lightgbm',
      'xgboost',
    ] as const) {
      const medium = tuningVariantsFor(algorithm, { distinctLabelled: 300 })
      for (const n of [32, 100, 900]) {
        expect(
          tuningVariantsFor(algorithm, { distinctLabelled: n }),
        ).not.toEqual(medium)
      }
    }
  })
})
