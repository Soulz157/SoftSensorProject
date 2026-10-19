import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  DEFAULT_FETCH_PERIOD,
  dwFetchConfigAtom,
  dwTimeRangeAtom,
  initDatasetWizardAtom,
  initDatasetWizardForEditAtom,
  resetDatasetWizardAtom,
} from '@/store/dataset-studio'
import {
  EMPTY_PIPELINE_CONFIG,
  type PipelineConfig,
} from '@/lib/pipeline-config'
import { DEFAULT_FETCH_CONFIG } from '@/lib/fetch-config'
import type { SavedDataset } from '@/store/datasets'

/** A new dataset fetches hourly (2026-10-19); a saved one keeps its own bucket. */
describe('default fetch period', () => {
  it('is 1 hour for a fresh wizard, after init and after reset', () => {
    const store = createStore()
    expect(DEFAULT_FETCH_PERIOD).toBe('1h')
    expect(store.get(dwTimeRangeAtom)).toBe('1h')

    store.set(dwTimeRangeAtom, '1min')
    store.set(initDatasetWizardAtom, {
      name: '',
      description: '',
      workspaceId: 'ws-1',
      sources: [],
    })
    expect(store.get(dwTimeRangeAtom)).toBe('1h')

    store.set(dwTimeRangeAtom, '1min')
    store.set(resetDatasetWizardAtom)
    expect(store.get(dwTimeRangeAtom)).toBe('1h')
  })

  function editSeed(overrides: Partial<PipelineConfig>) {
    return {
      dataset: {
        id: 'ds-1',
        name: 'Dataset',
        description: null,
        workspaceId: 'ws-1',
        sourceIds: [],
        tags: ['FI-1'],
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

  it('edit mode restores the saved Historical Fetch Settings, defaults for an old recipe', () => {
    const store = createStore()
    const saved = {
      calBasis: 'EventWeighted' as const,
      summaryType: ['Maximum' as const],
      summaryDuration: '30m',
      batchSize: 20,
    }
    store.set(initDatasetWizardForEditAtom, editSeed({ fetchConfig: saved }))
    expect(store.get(dwFetchConfigAtom)).toEqual(saved)

    store.set(initDatasetWizardForEditAtom, editSeed({}))
    expect(store.get(dwFetchConfigAtom)).toEqual(DEFAULT_FETCH_CONFIG)
  })

  it('edit mode keeps the saved recipe’s own period', () => {
    const store = createStore()
    store.set(initDatasetWizardForEditAtom, {
      dataset: {
        id: 'ds-1',
        name: 'Dataset',
        description: null,
        workspaceId: 'ws-1',
        sourceIds: [],
        tags: ['FI-1'],
        pipelineConfig: { ...EMPTY_PIPELINE_CONFIG, timeRange: '1min' },
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
    })
    expect(store.get(dwTimeRangeAtom)).toBe('1min')
  })
})
