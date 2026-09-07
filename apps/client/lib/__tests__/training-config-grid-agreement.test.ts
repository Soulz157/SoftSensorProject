import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import { ALGORITHMS, type Algorithm } from '@/store/model-pipeline'

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
 * A STATIC SOURCE GUARD, not a hand-copied table — the precedent
 * `lib/run-params.test.ts` set by reading the trainer's own `build_model`
 * source, and `tuning-grid.spec.ts` reuses in the other direction. Copying
 * the grid's values in here would produce a THIRD source of truth, and this
 * test would then pass forever while the real two drifted apart.
 *
 * WHAT AC7 ASKED FOR VS WHAT THIS ASSERTS. AC7 wanted "the suggested range
 * contains every value the DERIVED grid can produce for that algorithm at
 * that size." MODEL-FLOW-020-T03 closed as a no-op — capacity did not
 * separate on real holdouts at 32, 59 or 97 distinct labelled values — so
 * there is no derived grid and no "at that size" any more. The criterion's
 * intent survives intact against the fixed grid: every value the tuning phase
 * can actually try must sit inside the band the form advertises.
 */
const TUNING_GRID_FILE = path.resolve(
  __dirname,
  '../../../backend/src/lib/tuning-grid.ts',
)

/** Grid values per algorithm and key, read out of the backend's own source. */
function readGrid(): Record<string, Record<string, number[]>> {
  // A wrong path here fails at readFileSync with ENOENT before any assertion
  // below can report it — so if tuning-grid.ts moves, this constant is the
  // first thing to fix, not the failure message.
  const source = readFileSync(TUNING_GRID_FILE, 'utf-8')
  const start = source.indexOf('export const TUNING_GRID')
  if (start === -1) {
    throw new Error(
      'TUNING_GRID not found in apps/backend/src/lib/tuning-grid.ts — has it moved or been renamed?',
    )
  }
  const body = source.slice(start, source.indexOf('\n};', start))

  const result: Record<string, Record<string, number[]>> = {}
  // Bracket-scanned, NOT a `[...]` regex: `ols` and `ridge` declare their
  // whole entry on one line, so a lazy pattern anchored on a newline before
  // `],` runs past the end of those blocks and swallows the NEXT algorithm's
  // values. That mis-attribution is silent — it reads as "the grid varies a
  // key this form never shows" — so the span is found by counting brackets.
  const blocks: [string, string][] = []
  for (const header of body.matchAll(/^ {2}(\w+): \[/gm)) {
    const algorithm = header[1]
    if (!algorithm) continue
    const open = header.index + header[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < body.length; i++) {
      const ch = body[i]
      if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    blocks.push([algorithm, body.slice(open + 1, end)])
  }

  for (const [algorithm, entries] of blocks) {
    if (!algorithm || !entries) continue
    const perKey: Record<string, number[]> = {}
    for (const [, key, raw] of entries.matchAll(/(\w+):\s*([^,}\s]+)/g)) {
      if (!key || raw === undefined) continue
      // Strings (kernel/boosting_type) and `null` (random_forest's unlimited
      // depth) are not points on a numeric band — a select has no range, and
      // "unlimited" is a separate choice the toggle already explains.
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      ;(perKey[key] ??= []).push(value)
    }
    result[algorithm] = perKey
  }
  return result
}

const grid = readGrid()

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
  it('reads a grid that actually parsed — the guard is worthless if the regex silently matched nothing', () => {
    // Without this, a reformat of tuning-grid.ts would empty `grid` and every
    // containment assertion below would pass vacuously.
    expect(Object.keys(grid).length).toBeGreaterThanOrEqual(10)
    expect(grid['ridge']?.['alpha']).toEqual(
      expect.arrayContaining([0.01, 0.1, 10, 100]),
    )
  })

  for (const algorithm of ALGORITHMS) {
    const perKey = grid[algorithm]
    if (!perKey) continue // lstm/gru have no grid entry by design

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

/**
 * MODEL-FLOW-020-T06. The sweep's phase-1 candidates are this file's own
 * defaults (`defaultHyperparams`, use-model-training.ts) while phase 2 comes
 * from the backend grid — so the two tables must at minimum name the SAME
 * KEYS per algorithm, or a tuning phase would vary a knob the form never
 * showed.
 *
 * This is the enforcement T01(d) found missing. It sizes nothing from the
 * dataset: that half of T06 died with T03's closure, and no derivation exists
 * for these tables to agree about.
 */
describe('MODEL-FLOW-020-T06: HYPERPARAMS and TUNING_GRID name the same keys', () => {
  for (const algorithm of ALGORITHMS) {
    const perKey = grid[algorithm]
    if (!perKey) continue

    it(`${algorithm}: every grid key is a field the form actually shows`, () => {
      const formKeys = new Set((HYPERPARAMS[algorithm] ?? []).map(f => f.key))
      for (const key of Object.keys(perKey)) {
        expect(
          formKeys.has(key),
          `TUNING_GRID varies "${key}" for ${algorithm}, but the form has no such field — ` +
            'the tuning phase would change something the user was never shown.',
        ).toBe(true)
      }
    })
  }

  it('lstm and gru have no grid entry — they never reach build_model', () => {
    // Mirrors tuning-grid.spec.ts's own assertion from the other side of the
    // boundary: a grid for them would be dead code that looks live.
    expect(grid['lstm']).toBeUndefined()
    expect(grid['gru']).toBeUndefined()
  })
})
