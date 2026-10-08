import { describe, it, expect } from 'vitest'
import {
  asHyperparams,
  isAlgorithm,
  reconcileTarget,
  splitRatioToPercent,
} from '@/lib/model-draft-hydration'

/**
 * MODEL-FLOW-010-T07/T08. Covers the reconciliation rule V04 exists to
 * protect — a target the user deleted while editing the dataset must be
 * CLEARED and reported, not carried forward — plus the two narrowings that
 * stand between a plain-text/JSON database column and typed wizard atoms.
 */

describe('reconcileTarget (MODEL-FLOW-010-V04)', () => {
  it('keeps a target the dataset still has', () => {
    expect(reconcileTarget('TAG_A', ['TAG_A', 'TAG_B'])).toEqual({
      targets: ['TAG_A'],
      droppedTarget: null,
    })
  })

  it('clears a target the edit removed AND names it', () => {
    // Carrying it forward fails at run creation with a pyarrow
    // "No match for FieldRef.Name" that explains nothing.
    expect(reconcileTarget('TAG_GONE', ['TAG_A', 'TAG_B'])).toEqual({
      targets: [],
      droppedTarget: 'TAG_GONE',
    })
  })

  it('reports nothing when the draft never had a target', () => {
    expect(reconcileTarget(null, ['TAG_A'])).toEqual({
      targets: [],
      droppedTarget: null,
    })
  })

  it('treats an empty tag list as "cannot tell", not "the target is gone"', () => {
    // An empty list is also what a dataset that has not loaded looks like;
    // reporting a drop for it would be a lie the user cannot act on.
    expect(reconcileTarget('TAG_A', [])).toEqual({
      targets: ['TAG_A'],
      droppedTarget: null,
    })
  })
})

describe('isAlgorithm', () => {
  it('accepts a catalogue entry', () => {
    expect(isAlgorithm('ridge')).toBe(true)
  })

  it('rejects a value the catalogue no longer offers', () => {
    expect(isAlgorithm('elasticnet')).toBe(false)
  })
})

describe('asHyperparams', () => {
  it('keeps scalars, including null and false', () => {
    expect(
      asHyperparams({
        alpha: 1,
        kernel: 'rbf',
        fit_intercept: false,
        max_depth: null,
      }),
    ).toEqual({
      alpha: 1,
      kernel: 'rbf',
      fit_intercept: false,
      max_depth: null,
    })
  })

  it('drops nested values the grid cannot render', () => {
    // A nested object reaching an input renders "[object Object]" and is then
    // PATCHed straight back as one.
    expect(asHyperparams({ ok: 1, nested: { a: 1 }, list: [1, 2] })).toEqual({
      ok: 1,
    })
  })

  it('returns an empty record for a non-object column value', () => {
    expect(asHyperparams(null)).toEqual({})
    expect(asHyperparams('{}')).toEqual({})
    expect(asHyperparams([1, 2])).toEqual({})
  })
})

describe('splitRatioToPercent', () => {
  it('converts the stored FRACTION to the wizard PERCENTAGE', () => {
    // The trap this exists for: 0.8 must become 80, never stay 0.8 (which
    // would slice chronological_split at 0.8 rows) and never arrive as 80
    // from the server.
    expect(splitRatioToPercent(0.8)).toBe(80)
    expect(splitRatioToPercent(0.95)).toBe(95)
  })

  it('falls back to the wizard default when never configured', () => {
    expect(splitRatioToPercent(null)).toBe(80)
  })
})
