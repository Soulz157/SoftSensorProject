import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  dwCriticalTagsAtom,
  initDatasetWizardAtom,
  initDatasetWizardForEditAtom,
  resetDatasetWizardAtom,
} from '@/store/dataset-studio'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'

/**
 * Critical tags (Step 1 star) are recipe state: cleared on every fresh entry
 * into the wizard, and hydrated from pipelineConfig in edit mode.
 */

function editSeed(overrides: Partial<SavedDataset['pipelineConfig']> = {}) {
  return {
    dataset: {
      id: 'ds-1',
      name: 'Dataset',
      description: null,
      workspaceId: 'ws-1',
      sourceIds: [],
      tags: ['FI-1', 'TI-2'],
      pipelineConfig: { ...EMPTY_PIPELINE_CONFIG, ...overrides },
      fileUrl: null,
      rowCount: 0,
      missingPct: 0,
      createdById: 'user-1',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      currentVersionId: null,
      currentArtifactId: null,
      currentArtifactType: null,
    } as unknown as SavedDataset,
    sources: [],
  }
}

describe('dwCriticalTagsAtom', () => {
  it('initDatasetWizardAtom and resetDatasetWizardAtom both clear it', () => {
    const store = createStore()
    store.set(dwCriticalTagsAtom, ['FI-1'])
    store.set(initDatasetWizardAtom, {
      name: '',
      description: '',
      workspaceId: 'ws-1',
      sources: [],
    })
    expect(store.get(dwCriticalTagsAtom)).toEqual([])

    store.set(dwCriticalTagsAtom, ['FI-1'])
    store.set(resetDatasetWizardAtom)
    expect(store.get(dwCriticalTagsAtom)).toEqual([])
  })

  it('edit mode hydrates the saved list', () => {
    const store = createStore()
    store.set(
      initDatasetWizardForEditAtom,
      editSeed({ criticalTags: ['FI-1'] }),
    )
    expect(store.get(dwCriticalTagsAtom)).toEqual(['FI-1'])
  })

  it('a recipe saved before critical tags existed hydrates to none', () => {
    const store = createStore()
    store.set(dwCriticalTagsAtom, ['stale'])
    store.set(initDatasetWizardForEditAtom, editSeed())
    expect(store.get(dwCriticalTagsAtom)).toEqual([])
  })
})
