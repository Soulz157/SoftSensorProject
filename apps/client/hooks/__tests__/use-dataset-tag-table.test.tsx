import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useDatasetTagTable } from '../dataset/use-dataset-tag-table'
import { dwSelectedSourcesAtom } from '@/store/dataset-studio'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { UseDatasetPipelineNavResult } from '../dataset/use-dataset-pipeline-nav'

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

const PI_SOURCE: SavedDataSource = {
  // A real (non-demo) id: getSourceTagCatalog falls through to defaultMockTags,
  // which fabricates "<slug>_signal_1..3" — names PI never returns.
  id: 'b7f1c0de-0000-4000-8000-000000000001',
  name: 'Plant PI',
  type: 'aveva',
  host: 'pi.example',
  username: 'u',
  dbName: '',
  status: 'connected',
  lastUsed: '2026-07-30',
  createdBy: 'test',
}

/** Only the fields the row builder reads. */
const nav = {
  removedTags: [],
  editedTags: {},
  insertedTags: [],
  tagConstants: {},
  setTagConstant: () => {},
  removeTag: () => {},
  removeInsertedTag: () => {},
  insertTag: () => {},
  setEditedTag: () => {},
} as unknown as UseDatasetPipelineNavResult

function render(tagsBySource?: Map<string, string[]>) {
  return renderHook(() => useDatasetTagTable(nav, tagsBySource), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useDatasetTagTable row source', () => {
  it('uses real PI tag names so originalName matches the metadata map keys', () => {
    store.set(dwSelectedSourcesAtom, [PI_SOURCE])
    const piTags = ['AI-108F.PV', 'TI-204.PV']

    const { result } = render(new Map([[PI_SOURCE.id, piTags]]))

    expect(result.current.rows.map(r => r.originalName)).toEqual(piTags)
    // The exact lookup the table performs: metaByTag.get(row.originalName)
    const metaKeys = new Set(piTags)
    expect(result.current.rows.every(r => metaKeys.has(r.originalName))).toBe(
      true,
    )
    expect(result.current.rows[0]?.dataSource).toBe('Plant PI')
  })

  it('regression: without PI tags the rows are mock names that can never match', () => {
    store.set(dwSelectedSourcesAtom, [PI_SOURCE])

    const { result } = render() // no metadata yet — the pre-fix behaviour

    const names = result.current.rows.map(r => r.originalName)
    expect(names).toEqual([
      'plant_pi_signal_1',
      'plant_pi_signal_2',
      'plant_pi_signal_3',
    ])
    // This is the bug: real PI keys share nothing with these.
    const metaKeys = new Set(['AI-108F.PV', 'TI-204.PV'])
    expect(names.some(n => metaKeys.has(n))).toBe(false)
  })

  it('falls back to the mock catalogue when a source returned no PI tags', () => {
    store.set(dwSelectedSourcesAtom, [PI_SOURCE])

    const { result } = render(new Map([[PI_SOURCE.id, []]]))

    expect(result.current.rows.map(r => r.originalName)).toEqual([
      'plant_pi_signal_1',
      'plant_pi_signal_2',
      'plant_pi_signal_3',
    ])
  })

  it('leaves the demo seed source on its hand-authored catalogue', () => {
    store.set(dwSelectedSourcesAtom, [{ ...PI_SOURCE, id: 'ds-1' }])

    const { result } = render()

    expect(result.current.rows.map(r => r.originalName)).toContain('TI-101')
  })
})
