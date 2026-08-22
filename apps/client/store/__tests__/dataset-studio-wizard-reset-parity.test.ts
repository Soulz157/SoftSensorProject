import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  initDatasetWizardAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwFeaturedDatasetAtom,
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwBronzeWarmStateAtom,
  dwGoldWarmErrorAtom,
  dwDraftSyncStateAtom,
  dwValueClipAtom,
  dwSelectedTagKeysAtom,
} from '@/store/dataset-studio'
import { brandBoundedSample } from '@/lib/preprocessing'

/**
 * Bug: editing a dataset, then opening Create New Dataset, showed the prior
 * edit session's tags. `initDatasetWizardAtom` — the only reset function
 * `handleDatasetCreated` calls before navigating to /data-studio/create —
 * correctly cleared `dwSelectedTagsAtom`, but never touched
 * `dwFeaturePreviewSampleAtom`, which is what the tag sidebar and every
 * chart actually read their displayed tag list from (via the derived
 * `dwFeaturedDatasetAtom`). `resetDatasetWizardAtom` (the OTHER wizard-clear
 * function, used after Save) already had this exact fix — see its own
 * "THE GROUP THAT CAUSED THE DRIFT" comment — but `initDatasetWizardAtom`
 * never got the equivalent block. This pins parity between the two going
 * forward, the same convention dataset-studio-feature-preset.test.ts already
 * uses for a different atom set ("the two lists are maintained by hand and
 * nothing enforces they agree").
 */

const SEED = {
  name: 'New dataset',
  description: '',
  workspaceId: 'ws-2',
  sources: [],
}

describe('initDatasetWizardAtom clears the draft-first server state group', () => {
  it('clears dwFeaturePreviewSampleAtom and its fetch state', () => {
    const store = createStore()
    store.set(
      dwFeaturePreviewSampleAtom,
      brandBoundedSample({
        tags: ['TI-101', 'TI-102'],
        rows: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            cells: {
              'TI-101': { value: 1, status: 'Good' },
              'TI-102': { value: 2, status: 'Good' },
            },
          },
        ],
      }),
    )
    store.set(dwFeaturePreviewSampleStateAtom, 'ready')

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwFeaturePreviewSampleAtom).tags).toEqual([])
    expect(store.get(dwFeaturePreviewSampleAtom).rows).toEqual([])
    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('idle')
  })

  it('clears the draft-id atoms — a stale id can otherwise re-fire a fetch of the prior session', () => {
    const store = createStore()
    store.set(dwDraftIdAtom, 'draft-old')
    store.set(dwDraftArtifactIdAtom, 'art-old')
    store.set(dwDraftGoldArtifactIdAtom, 'gold-old')
    store.set(dwBronzeWarmStateAtom, 'materializing')
    store.set(dwGoldWarmErrorAtom, 'some error')
    store.set(dwDraftSyncStateAtom, { status: 'syncing' })

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwDraftIdAtom)).toBeNull()
    expect(store.get(dwDraftArtifactIdAtom)).toBeNull()
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
    expect(store.get(dwBronzeWarmStateAtom)).toBe('idle')
    expect(store.get(dwGoldWarmErrorAtom)).toBeNull()
    expect(store.get(dwDraftSyncStateAtom)).toEqual({ status: 'idle' })
  })

  it('clears dwValueClipAtom and dwSelectedTagKeysAtom (Step 3 state)', () => {
    const store = createStore()
    store.set(dwValueClipAtom, { 'TI-101': { min: 0, max: 100 } })
    store.set(dwSelectedTagKeysAtom, new Set(['TI-101']))

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwValueClipAtom)).toEqual({})
    expect(store.get(dwSelectedTagKeysAtom)).toEqual(new Set())
  })

  it('reproduces the reported symptom: a fresh Create no longer shows the prior edit session tags', () => {
    // Simulates the state right after a user finishes editing a dataset with
    // tags TI-101/TI-102, then clicks "Create New Dataset" — before this
    // fix, `dwFeaturedDatasetAtom` (what DatasetTagSidebar renders) still
    // carried these two tags into the newly opened wizard.
    const store = createStore()
    store.set(
      dwFeaturePreviewSampleAtom,
      brandBoundedSample({
        tags: ['TI-101', 'TI-102'],
        rows: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            cells: {
              'TI-101': { value: 1, status: 'Good' },
              'TI-102': { value: 2, status: 'Good' },
            },
          },
        ],
      }),
    )

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwFeaturedDatasetAtom).tags).toEqual([])
  })
})
