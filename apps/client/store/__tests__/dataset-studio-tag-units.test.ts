import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwTagUnitOverridesAtom,
  dwTagUnitsAtom,
  initDatasetWizardAtom,
  resetDatasetWizardAtom,
  type PresetRangeCandidate,
} from '@/store/dataset-studio'

/**
 * DS-LAKE-020-T03: `dwTagUnitsAtom` snapshots each selected tag's engineering
 * unit from Step 1, since `useDatasetTagMetadata`'s `metaByTag` is hook-local
 * and dies with the component. Both wizard-clear entry points must reset it —
 * `dataset-studio-wizard-reset-parity.test.ts` already pins this convention
 * for other atoms ("the two lists are maintained by hand and nothing
 * enforces they agree").
 *
 * `dwTagUnitOverridesAtom` is its sibling: a user-entered unit for a tag with
 * no PI-reported one (CSV/manual, or a PI tag whose metadata omits it) — same
 * session-only lifetime, same two reset entry points.
 */

const SEED = {
  name: 'New dataset',
  description: '',
  workspaceId: 'ws-2',
  sources: [],
}

const UNITS = { 'TI-101': 'C', 'FI-204': 'kg/h', 'XX-999': null }

describe('dwTagUnitsAtom reset parity', () => {
  it('initDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwTagUnitsAtom, UNITS)

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwTagUnitsAtom)).toEqual({})
  })

  it('resetDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwTagUnitsAtom, UNITS)

    store.set(resetDatasetWizardAtom)

    expect(store.get(dwTagUnitsAtom)).toEqual({})
  })

  it('holds a unit-or-null per tag name', () => {
    const store = createStore()
    store.set(dwTagUnitsAtom, UNITS)

    expect(store.get(dwTagUnitsAtom)).toEqual(UNITS)
  })
})

const OVERRIDES = { 'CSV-01': 'kg/h', 'MANUAL-02': 'C' }

describe('dwTagUnitOverridesAtom reset parity', () => {
  it('initDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwTagUnitOverridesAtom, OVERRIDES)

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwTagUnitOverridesAtom)).toEqual({})
  })

  it('resetDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwTagUnitOverridesAtom, OVERRIDES)

    store.set(resetDatasetWizardAtom)

    expect(store.get(dwTagUnitOverridesAtom)).toEqual({})
  })

  it('holds a user-entered unit per tag name, with no null entries (absence means "no override", not a known-empty unit)', () => {
    const store = createStore()
    store.set(dwTagUnitOverridesAtom, OVERRIDES)

    expect(store.get(dwTagUnitOverridesAtom)).toEqual(OVERRIDES)
  })
})

const CANDIDATES: PresetRangeCandidate[] = [
  {
    tag: 'TI-101',
    rowLabel: 'TI-101',
    quotedRange: '105-120 C',
    parsed: { kind: 'closed', min: 105, max: 120, unit: 'C', raw: '105-120 C' },
    presetId: 's-204-no1',
    configNo: 1,
    sheet: 'S-204',
  },
]

describe('dwPresetRangeAtom reset parity', () => {
  it('initDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwPresetRangeAtom, CANDIDATES)

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwPresetRangeAtom)).toEqual([])
  })

  it('resetDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwPresetRangeAtom, CANDIDATES)

    store.set(resetDatasetWizardAtom)

    expect(store.get(dwPresetRangeAtom)).toEqual([])
  })
})

describe('dwPresetRangeStaleAtom reset parity', () => {
  it('initDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwPresetRangeStaleAtom, true)

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwPresetRangeStaleAtom)).toBe(false)
  })

  it('resetDatasetWizardAtom clears it', () => {
    const store = createStore()
    store.set(dwPresetRangeStaleAtom, true)

    store.set(resetDatasetWizardAtom)

    expect(store.get(dwPresetRangeStaleAtom)).toBe(false)
  })
})
