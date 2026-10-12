import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { WizardSnapshotValues } from '@/lib/dataset-wizard-snapshot'
import {
  readWizardSnapshotValues,
  writeWizardSnapshotValues,
} from '@/hooks/dataset/dataset-wizard-snapshot-atoms'
import {
  dwDraftArtifactIdAtom,
  dwRawDatasetAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagKeysAtom,
  initDatasetWizardAtom,
} from '@/store/dataset-studio'

const SOURCE = { id: 'src-1', type: 'aveva', name: 'PI' } as SavedDataSource

function values(store: ReturnType<typeof createStore>): WizardSnapshotValues {
  return {
    ...readWizardSnapshotValues(store),
    name: 'Boiler',
    workspaceId: 'ws-1',
    sourceIds: ['src-1'],
    selectedTags: ['T1', 'T2'],
    selectedTagKeys: ['T1'],
    cleaningTags: ['T1'],
    targetTag: 'T2',
    currentStep: 4,
    highestUnlocked: 5,
  }
}

describe('wizard snapshot <-> dw* atoms (DS-LAKE-037)', () => {
  it('write then read returns the same values, with the Set carried as an array', () => {
    const store = createStore()
    const v = values(store)

    writeWizardSnapshotValues(store, v, [SOURCE])

    expect(store.get(dwSelectedTagKeysAtom)).toEqual(new Set(['T1']))
    expect(readWizardSnapshotValues(store)).toEqual(v)
  })

  it('stores source ids only and restores the live source objects', () => {
    const store = createStore()
    writeWizardSnapshotValues(store, values(store), [SOURCE])

    expect(store.get(dwSelectedSourcesAtom)).toEqual([SOURCE])
    expect(readWizardSnapshotValues(store).sourceIds).toEqual(['src-1'])
  })

  it('never reads or writes row data or server artifact ids', () => {
    const store = createStore()
    store.set(dwRawDatasetAtom, {
      tags: ['T1'],
      rows: [{ timestamp: 't' }],
    } as never)
    store.set(dwDraftArtifactIdAtom, 'art-1')

    const read = readWizardSnapshotValues(store)
    expect(JSON.stringify(read)).not.toContain('timestamp')
    expect(JSON.stringify(read)).not.toContain('art-1')

    // Restoring a snapshot over a reset wizard leaves rows empty and the
    // artifact id null, which is what makes resume re-fetch.
    store.set(initDatasetWizardAtom, {
      name: '',
      description: '',
      workspaceId: 'ws-1',
      sources: [SOURCE],
    })
    writeWizardSnapshotValues(store, values(store), [SOURCE])
    expect(store.get(dwRawDatasetAtom).rows).toEqual([])
    expect(store.get(dwDraftArtifactIdAtom)).toBeNull()
  })
})
