import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  dwCurrentStepAtom,
  dwCustomDateRangeAtom,
  dwEditingDatasetAtom,
  dwEditingDatasetIdAtom,
  dwFeatureConfigsAtom,
  dwHoldoutRangeAtom,
  dwModeAtom,
  dwNameAtom,
  dwRawDatasetAtom,
  dwSelectedTagsAtom,
  initDatasetWizardFromBaseRecipeAtom,
  initDatasetWizardAtom,
  initDatasetWizardForEditAtom,
  dwFromRetrainAtom,
} from '@/store/dataset-studio'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'
import type { SavedDataSource } from '@/lib/mock-data-sources'

/**
 * MODEL-SERVE-017. The retrain "fetch new data" handoff opens the wizard on a
 * NEW dataset that inherits a base dataset's recipe over a different window.
 *
 * The failure this pins is silent and destructive: if the session stays in
 * EDIT mode, Save writes a new VERSION OF THE BASE and repoints its
 * `currentVersionId` at a slice holding only the new range — corrupting a
 * dataset other models may still train on. Nothing about the UI would look
 * wrong while that happened.
 */

const SOURCE = { id: 'src-1', name: 'PI Server' } as SavedDataSource

const BASE = {
  id: 'ds-base',
  name: 'Reactor tags',
  workspaceId: 'ws-1',
  sourceIds: ['src-1'],
  tags: ['TI-101', 'PT-201'],
  pipelineConfig: {
    ...EMPTY_PIPELINE_CONFIG,
    baseTags: ['TI-101', 'PT-201'],
    customDateRange: { from: '2025-01-01T00:00', to: '2025-06-01T00:00' },
    holdoutDateRange: { from: '2025-05-01T00:00', to: '2025-06-01T00:00' },
    features: [{ id: 'f1', name: 'roll_mean', kind: 'rolling' }],
  },
} as unknown as SavedDataset

const CUT = '2026-01-16 00:00:00'

function seeded() {
  const store = createStore()
  store.set(initDatasetWizardFromBaseRecipeAtom, {
    dataset: BASE,
    sources: [SOURCE],
    name: 'Reactor tags — Feb 2026',
    cutTimestamp: CUT,
  })
  return store
}

describe('initDatasetWizardFromBaseRecipeAtom', () => {
  it('opens a CREATE session, never an edit of the base dataset', () => {
    const store = seeded()
    expect(store.get(dwModeAtom)).toBe('create')
    // '' is this atom's "nothing being edited" value. A real id here would
    // send Save down the edit path, writing a new version of the base.
    expect(store.get(dwEditingDatasetIdAtom)).toBe('')
    expect(store.get(dwEditingDatasetAtom)).toBeNull()
  })

  it('carries the base recipe across — that is the whole point', () => {
    const store = seeded()
    // Tags and the feature recipe must match the base, because
    // `assertCompatible` refuses a dataset whose tag set disagrees.
    expect(store.get(dwSelectedTagsAtom)).toEqual(['TI-101', 'PT-201'])
    expect(store.get(dwFeatureConfigsAtom)).toHaveLength(1)
  })

  it('leaves the window unset, and drops the base holdout', () => {
    const store = seeded()
    // MODEL-SERVE-017. The range is chosen at Step 2 now — seeding one here
    // meant the operator picked a date range twice. The base's own window
    // must NOT carry over: it describes the base's data, not this dataset's.
    expect(store.get(dwCustomDateRangeAtom)).toBeNull()
    // A holdout picked inside the base's window means nothing inside a
    // different one, and a stale window silently splits the wrong rows.
    expect(store.get(dwHoldoutRangeAtom)).toBeNull()
  })

  it('clears the base rows and lands on the fetch step', () => {
    const store = seeded()
    // The base's rows belong to the base's window. Leaving them would show
    // the operator data from a range they did not ask for.
    expect(store.get(dwRawDatasetAtom).rows).toEqual([])
    expect(store.get(dwCurrentStepAtom)).toBe(2)
  })

  it('names the new dataset, rather than inheriting the base name', () => {
    const store = seeded()
    expect(store.get(dwNameAtom)).toBe('Reactor tags — Feb 2026')
  })

  // MODEL-SERVE-017. The flag Step 4 reads to suppress the holdout picker.
  it('marks the session as retrain-built, and every other seeder clears it', () => {
    const store = seeded()
    expect(store.get(dwFromRetrainAtom)).toBe(true)

    // A holdout here is never evaluated against — `combine_for_retrain`
    // scores on the BASE's frozen rows — while `_split_holdout` keeps only
    // rows OUTSIDE the window in the committed SILVER. So one picked here
    // costs training rows for nothing, which is why the picker is hidden.
    expect(store.get(dwHoldoutRangeAtom)).toBeNull()

    // It must not leak into an ordinary dataset build in the same tab: the
    // wizard is an SPA nav, so nothing remounts between these two.
    store.set(initDatasetWizardAtom, {
      name: 'Unrelated',
      description: '',
      workspaceId: 'ws-2',
      sources: [],
    })
    expect(store.get(dwFromRetrainAtom)).toBe(false)
  })

  it('is cleared by the edit seeder too', () => {
    const store = seeded()
    expect(store.get(dwFromRetrainAtom)).toBe(true)

    store.set(initDatasetWizardForEditAtom, {
      dataset: BASE,
      sources: [SOURCE],
    })
    expect(store.get(dwFromRetrainAtom)).toBe(false)
  })
})
