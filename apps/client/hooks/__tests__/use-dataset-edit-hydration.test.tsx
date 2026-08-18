import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { PropsWithChildren } from 'react'
import { useDatasetEditHydration } from '../dataset/use-dataset-edit-hydration'
import {
  dwEditingDatasetAtom,
  dwModeAtom,
  dwRawDatasetAtom,
  dwRowSourceAtom,
  dwSyntheticReasonAtom,
} from '@/store/dataset-studio'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'

/**
 * Closes F5's last gap. Everything below this hook was verified live — the
 * artifact in MinIO, and `GET /versions/:id/rows` returning it exactly — but
 * nothing proved the WIZARD ends up holding those rows rather than generated
 * ones. That difference is invisible on screen, which is the whole reason F5
 * exists, so it is pinned here instead of resting on a browser pass.
 */

const list = vi.fn()
const fetchDataset = vi.fn()

// `fetchVersionDataset` is mocked rather than left real: it closes over the
// module's own `datasetVersionService` binding, so replacing only the service
// would still send it down the real fetchClient. Its paging loop is already
// pinned in lib/__tests__/dataset-version.test.ts — what matters here is which
// version id it is asked for, and where the rows land.
vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    list: (...args: unknown[]) => list(...args),
    createRaw: vi.fn(),
  },
  fetchVersionDataset: (...args: unknown[]) => fetchDataset(...args),
}))

const STORED_ROWS = [
  {
    timestamp: '2026-06-22T00:00:00.000Z',
    cells: { 'TI-101': { value: 11.5, status: 'Good' as const } },
  },
  {
    timestamp: '2026-06-22T00:01:00.000Z',
    cells: { 'TI-101': { value: 22.25, status: 'Bad' as const } },
  },
]

const dataset = (over: Partial<SavedDataset> = {}): SavedDataset =>
  ({
    id: 'ds-1',
    name: 'Boiler',
    description: null,
    workspaceId: 'ws-1',
    sourceIds: ['src-1'],
    tags: ['TI-101'],
    pipelineConfig: {
      ...EMPTY_PIPELINE_CONFIG,
      baseTags: ['TI-101'],
      customDateRange: { from: '2026-06-22T00:00', to: '2026-06-22T01:00' },
      sourceFetchConfigs: { 'src-1': { type: 'pi' } as never },
    },
    fileUrl: null,
    rowCount: 2,
    missingPct: 0,
    currentVersionId: 'ver-1',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    createdBy: 'tester',
    ...over,
  }) as SavedDataset

let store: ReturnType<typeof createStore>

const wrapper = ({ children }: PropsWithChildren) => (
  <Provider store={store}>{children}</Provider>
)

beforeEach(() => {
  vi.clearAllMocks()
  store = createStore()
  store.set(dwModeAtom, 'edit')
  list.mockResolvedValue({
    data: [{ id: 'ver-1', stage: 'RAW', versionNumber: 1 }],
  })
  fetchDataset.mockResolvedValue({ tags: ['TI-101'], rows: STORED_ROWS })
})

describe('useDatasetEditHydration', () => {
  it('fills the wizard from the committed artifact, not from generated rows', async () => {
    store.set(dwEditingDatasetAtom, dataset())

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await waitFor(() => expect(store.get(dwRowSourceAtom)).toBe('stored'))
    const raw = store.get(dwRawDatasetAtom)
    // Values, not just a row count: generated rows would also be 2 long. These
    // are the exact numbers the artifact holds, including the Bad cell that
    // downstream cleaning has to see as missing.
    expect(raw.tags).toEqual(['TI-101'])
    expect(raw.rows.map(r => r.cells['TI-101']!.value)).toEqual([11.5, 22.25])
    expect(raw.rows.map(r => r.cells['TI-101']!.status)).toEqual([
      'Good',
      'Bad',
    ])
    expect(store.get(dwSyntheticReasonAtom)).toBeNull()
  })

  it('reads the RAW version, not the newest one', async () => {
    // After a cleaning job `currentVersionId` points at a CLEAN artifact, and
    // replaying the recipe over that would apply every operation twice.
    store.set(dwEditingDatasetAtom, dataset({ currentVersionId: 'ver-2' }))
    list.mockResolvedValue({
      data: [
        { id: 'ver-1', stage: 'RAW', versionNumber: 1 },
        { id: 'ver-2', stage: 'CLEAN', versionNumber: 2 },
      ],
    })

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await waitFor(() => expect(fetchDataset).toHaveBeenCalled())
    expect(fetchDataset.mock.calls[0]![1]).toBe('ver-1')
  })

  it('says so, loudly, when it falls back to generated rows', async () => {
    // No artifact AND an unreplayable recipe. Presenting invented numbers
    // silently is the exact failure this slice removes.
    store.set(
      dwEditingDatasetAtom,
      dataset({
        currentVersionId: null,
        pipelineConfig: { ...EMPTY_PIPELINE_CONFIG, baseTags: [] },
      }),
    )

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await waitFor(() => expect(store.get(dwRowSourceAtom)).toBe('synthetic'))
    expect(store.get(dwSyntheticReasonAtom)).toMatch(/original tag list/i)
    expect(fetchDataset).not.toHaveBeenCalled()
  })

  it('stays out of the way in create mode', async () => {
    store.set(dwModeAtom, 'create')
    store.set(dwEditingDatasetAtom, dataset())

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await new Promise(r => setTimeout(r, 20))
    // Create-mode rows come from the live fetch in use-dataset-studio-fetch.
    // If this hook ran too, the two would race for the same atom.
    expect(fetchDataset).not.toHaveBeenCalled()
    expect(store.get(dwRowSourceAtom)).toBeNull()
  })
})
