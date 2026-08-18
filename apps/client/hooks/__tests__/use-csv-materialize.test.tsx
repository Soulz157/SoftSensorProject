import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useCsvMaterialize } from '../dataset/use-csv-materialize'
import {
  dwCsvDatasetAtom,
  dwFetchStateAtom,
  dwRawDatasetAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwTagConstantsAtom,
} from '@/store/dataset-studio'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { Dataset } from '@/lib/preprocessing'

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

function source(type: SavedDataSource['type']): SavedDataSource {
  return {
    id: `ds-${type}`,
    name: `${type} source`,
    type,
    host: 'localhost',
    username: 'u',
    dbName: 'db',
    status: 'connected',
    lastUsed: '2026-07-30',
    createdBy: 'test',
  }
}

const CSV_DATASET: Dataset = {
  tags: ['TI-101', 'PI-303'],
  rows: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      cells: {
        'TI-101': { value: 1, status: 'Good' },
        'PI-303': { value: 2, status: 'Good' },
      },
    },
    {
      timestamp: '2026-01-01T00:01:00.000Z',
      cells: {
        'TI-101': { value: 3, status: 'Good' },
        'PI-303': { value: 4, status: 'Good' },
      },
    },
  ],
}

function render() {
  return renderHook(() => useCsvMaterialize(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useCsvMaterialize', () => {
  it('materializes the CSV and settles the fetch state without any API call', () => {
    store.set(dwSelectedSourcesAtom, [source('csv')])
    store.set(dwCsvDatasetAtom, CSV_DATASET)
    store.set(dwSelectedTagsAtom, ['TI-101'])

    const { result } = render()

    expect(result.current.fetchRequired).toBe(false)
    expect(store.get(dwFetchStateAtom)).toEqual({
      status: 'done',
      progress: 100,
    })

    const raw = store.get(dwRawDatasetAtom)
    // Only the selected tag survives — the CSV's other column is dropped.
    expect(raw.tags).toEqual(['TI-101'])
    expect(raw.rows).toHaveLength(2)
    expect(raw.rows[0]?.cells['TI-101']).toEqual({ value: 1, status: 'Good' })
    expect(raw.rows[0]?.cells['PI-303']).toBeUndefined()
  })

  it('backfills a selected tag the file does not carry as Bad', () => {
    store.set(dwSelectedSourcesAtom, [source('csv')])
    store.set(dwCsvDatasetAtom, CSV_DATASET)
    store.set(dwSelectedTagsAtom, ['TI-101', 'manual-tag'])

    render()

    const raw = store.get(dwRawDatasetAtom)
    expect(raw.tags).toEqual(['TI-101', 'manual-tag'])
    expect(raw.rows[0]?.cells['manual-tag']).toEqual({
      value: 0,
      status: 'Bad',
    })
  })

  it('overlays constants over the materialized grid', () => {
    store.set(dwSelectedSourcesAtom, [source('csv')])
    store.set(dwCsvDatasetAtom, CSV_DATASET)
    store.set(dwSelectedTagsAtom, ['TI-101', 'ambient'])
    store.set(dwTagConstantsAtom, { ambient: 25 })

    render()

    const raw = store.get(dwRawDatasetAtom)
    expect(raw.rows[0]?.cells.ambient).toEqual({ value: 25, status: 'Good' })
    expect(raw.rows[1]?.cells.ambient).toEqual({ value: 25, status: 'Good' })
  })

  it('stays out of the way when a fetch-required source is selected', () => {
    store.set(dwSelectedSourcesAtom, [source('aveva')])
    store.set(dwCsvDatasetAtom, CSV_DATASET)
    store.set(dwSelectedTagsAtom, ['TI-101'])

    const { result } = render()

    expect(result.current.fetchRequired).toBe(true)
    expect(store.get(dwFetchStateAtom).status).toBe('idle')
    expect(store.get(dwRawDatasetAtom).rows).toHaveLength(0)
  })

  it('re-materializes after a second upload resets the fetch state', () => {
    store.set(dwSelectedSourcesAtom, [source('csv')])
    store.set(dwCsvDatasetAtom, CSV_DATASET)
    store.set(dwSelectedTagsAtom, ['TI-101'])

    const { rerender } = render()
    expect(store.get(dwRawDatasetAtom).rows[0]?.cells['TI-101']?.value).toBe(1)

    // What `uploadCompare` does for a second file: swap the parsed grid and run
    // the same reset chain (status back to idle, raw dataset cleared).
    store.set(dwCsvDatasetAtom, {
      tags: ['TI-101'],
      rows: [
        {
          timestamp: '2026-02-01T00:00:00.000Z',
          cells: { 'TI-101': { value: 99, status: 'Good' } },
        },
      ],
    })
    store.set(dwFetchStateAtom, { status: 'idle', progress: 0 })
    store.set(dwRawDatasetAtom, { tags: [], rows: [] })
    rerender()

    const raw = store.get(dwRawDatasetAtom)
    expect(raw.rows).toHaveLength(1)
    expect(raw.rows[0]?.cells['TI-101']).toEqual({ value: 99, status: 'Good' })
    expect(store.get(dwFetchStateAtom).status).toBe('done')
  })

  it('does nothing until a file has been uploaded', () => {
    store.set(dwSelectedSourcesAtom, [source('csv')])
    store.set(dwSelectedTagsAtom, ['TI-101'])

    const { result } = render()

    expect(result.current.hasCsvData).toBe(false)
    expect(store.get(dwFetchStateAtom).status).toBe('idle')
  })
})
