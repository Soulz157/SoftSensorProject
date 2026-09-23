import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  initDatasetWizardAtom,
  initDatasetWizardForEditAtom,
  resetDatasetWizardAtom,
  dwFetchStateAtom,
  dwFetchTagsAtom,
  initDatasetWizardFromBaseRecipeAtom,
  dwEdaSampleTotalAtom,
  dwEdaWindowAtom,
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
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import { monthWindow } from '@/lib/time-window'

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

  it('DS-LAKE-027: initDatasetWizardForEditAtom clears the same group', () => {
    // The third initializer had the same gap, with a worse symptom: a
    // create -> edit switch in one tab is an SPA nav, so a prior session's
    // `'error'` preview state survived and rendered Step 3's "Preview sample
    // unavailable" before any request was made.
    const store = createStore()
    store.set(
      dwFeaturePreviewSampleAtom,
      brandBoundedSample({
        tags: ['TI-101'],
        rows: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            cells: { 'TI-101': { value: 1, status: 'Good' } },
          },
        ],
      }),
    )
    store.set(dwFeaturePreviewSampleStateAtom, 'error')
    store.set(dwDraftGoldArtifactIdAtom, 'gold-old')
    store.set(dwBronzeWarmStateAtom, 'materializing')
    store.set(dwDraftSyncStateAtom, { status: 'error' })

    store.set(initDatasetWizardForEditAtom, {
      dataset: {
        id: 'ds-1',
        name: 'Edited',
        description: null,
        workspaceId: 'ws-2',
        sourceIds: [],
        tags: ['TI-200'],
        pipelineConfig: EMPTY_PIPELINE_CONFIG,
        fileUrl: null,
        rowCount: 0,
        missingPct: 0,
        currentVersionId: null,
        currentArtifactId: null,
        currentArtifactType: null,
        adoptedBronzeArtifactId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdBy: 'user-1',
      },
      sources: [],
    })

    expect(store.get(dwFeaturePreviewSampleAtom).tags).toEqual([])
    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('idle')
    expect(store.get(dwDraftGoldArtifactIdAtom)).toBeNull()
    expect(store.get(dwBronzeWarmStateAtom)).toBe('idle')
    expect(store.get(dwDraftSyncStateAtom)).toEqual({ status: 'idle' })
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

  it('clears the EDA period and its row total — a month left over would filter the next dataset to nothing', () => {
    const store = createStore()
    store.set(dwEdaWindowAtom, monthWindow(2026, 3))
    store.set(dwEdaSampleTotalAtom, 43_200)

    store.set(initDatasetWizardAtom, SEED)

    expect(store.get(dwEdaWindowAtom)).toBeNull()
    expect(store.get(dwEdaSampleTotalAtom)).toBeNull()
  })

  it('resetDatasetWizardAtom and initDatasetWizardForEditAtom clear the EDA period too', () => {
    const seeded = () => {
      const store = createStore()
      store.set(dwEdaWindowAtom, monthWindow(2026, 3))
      store.set(dwEdaSampleTotalAtom, 43_200)
      return store
    }

    const reset = seeded()
    reset.set(resetDatasetWizardAtom)
    expect(reset.get(dwEdaWindowAtom)).toBeNull()
    expect(reset.get(dwEdaSampleTotalAtom)).toBeNull()

    const edit = seeded()
    edit.set(initDatasetWizardForEditAtom, {
      dataset: {
        id: 'ds-1',
        name: 'Edited',
        description: null,
        workspaceId: 'ws-2',
        sourceIds: [],
        tags: ['TI-200'],
        pipelineConfig: EMPTY_PIPELINE_CONFIG,
        fileUrl: null,
        rowCount: 0,
        missingPct: 0,
        currentVersionId: null,
        currentArtifactId: null,
        currentArtifactType: null,
        adoptedBronzeArtifactId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdBy: 'user-1',
      },
      sources: [],
    })
    expect(edit.get(dwEdaWindowAtom)).toBeNull()
    expect(edit.get(dwEdaSampleTotalAtom)).toBeNull()
  })
})

/**
 * MODEL-SERVE-017. The FOURTH initializer. It composes
 * `initDatasetWizardForEditAtom` to inherit a base dataset's recipe, which
 * means it also inherits that seeder's assumption that the dataset's bytes
 * already exist — and this session has none yet, it is about to fetch a
 * window nothing has read.
 *
 * Symptom if this drifts: Step 2 shows a completed fetch over an empty row
 * set, or a synthetic-rows banner in a session with no rows. Neither throws.
 */
describe('initDatasetWizardFromBaseRecipeAtom clears the same group', () => {
  const BASE_DATASET = {
    id: 'ds-base',
    name: 'Reactor tags',
    description: null,
    workspaceId: 'ws-2',
    sourceIds: [],
    tags: ['TI-200'],
    pipelineConfig: { ...EMPTY_PIPELINE_CONFIG, baseTags: ['TI-200'] },
    fileUrl: null,
    rowCount: 0,
    missingPct: 0,
    currentVersionId: null,
    currentArtifactId: null,
    currentArtifactType: null,
    adoptedBronzeArtifactId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'user-1',
  }

  function seedFromBase() {
    const store = createStore()
    // Dirty every atom in the group first, so a passing assertion proves the
    // seeder cleared it rather than that it was never set.
    store.set(
      dwFeaturePreviewSampleAtom,
      brandBoundedSample({
        tags: ['TI-101'],
        rows: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            cells: { 'TI-101': { value: 1, status: 'Good' } },
          },
        ],
      }),
    )
    store.set(dwFeaturePreviewSampleStateAtom, 'ready')
    store.set(dwBronzeWarmStateAtom, 'materializing')
    store.set(dwDraftSyncStateAtom, { status: 'syncing' })
    store.set(dwEdaWindowAtom, monthWindow(2025, 1))
    store.set(dwEdaSampleTotalAtom, 5000)

    store.set(initDatasetWizardFromBaseRecipeAtom, {
      dataset: BASE_DATASET,
      sources: [],
      name: 'Reactor tags — Feb 2026',
      cutTimestamp: '2026-01-16 00:00:00',
    })
    return store
  }

  it('clears the preview sample and its state', () => {
    const store = seedFromBase()
    expect(store.get(dwFeaturePreviewSampleAtom).tags).toEqual([])
    expect(store.get(dwFeaturePreviewSampleAtom).rows).toEqual([])
    expect(store.get(dwFeaturePreviewSampleStateAtom)).toBe('idle')
  })

  it('clears the warm/sync state — no fetch has run for this window', () => {
    const store = seedFromBase()
    expect(store.get(dwBronzeWarmStateAtom)).toBe('idle')
    expect(store.get(dwDraftSyncStateAtom)).toEqual({ status: 'idle' })
  })

  it('reports fetch state IDLE, not the edit path’s "fetching"', () => {
    // The one value that actually differs between the two parent seeders,
    // and the reason this block is load-bearing rather than defensive. The
    // edit seeder sets `{status: 'fetching'}` because
    // `useDatasetEditHydration` starts loading the dataset's existing rows
    // the moment the wizard mounts. Nothing hydrates a create session, so
    // inheriting that value leaves Step 2 showing a fetch in progress that
    // never finishes, over an empty row set — no error, no request, just a
    // spinner.
    const store = seedFromBase()
    expect(store.get(dwFetchStateAtom)).toEqual({
      status: 'idle',
      progress: 0,
    })
    // Same reason: the edit path pre-fills the tags it is about to hydrate.
    expect(store.get(dwFetchTagsAtom)).toBeNull()
  })

  it('clears the EDA window and sample total', () => {
    const store = seedFromBase()
    expect(store.get(dwEdaWindowAtom)).toBeNull()
    expect(store.get(dwEdaSampleTotalAtom)).toBeNull()
  })
})
