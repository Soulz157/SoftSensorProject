import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { PropsWithChildren } from 'react'
import { useDatasetEditHydration } from '../dataset/use-dataset-edit-hydration'
import {
  dwDraftArtifactIdAtom,
  dwDraftIdAtom,
  dwEditingDatasetAtom,
  dwEditingDatasetIdAtom,
  dwEditRootValidationRowCountAtom,
  dwModeAtom,
  dwRawDatasetAtom,
  dwRowSourceAtom,
  dwRowStageAtom,
  dwSyntheticReasonAtom,
} from '@/store/dataset-studio'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'

const resolveOrCreateForDataset = vi.fn()

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    resolveOrCreateForDataset: (...args: unknown[]) =>
      resolveOrCreateForDataset(...args),
  },
}))

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
// DS-LAKE-024-T08: hoisted (was a bare inline `vi.fn()`) so a test can assert
// on branch 2's materialize call — the case where the dataset has no artifact
// at all and the rows path mints its first BRONZE.
const createRaw = vi.fn()

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    list: (...args: unknown[]) => list(...args),
    createRaw: (...args: unknown[]) => createRaw(...args),
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
  createRaw.mockResolvedValue({ data: { id: 'fresh-bronze-1' } })
  // Never resolves unless a test opts in by setting dwEditingDatasetIdAtom
  // (left at its default '' otherwise) — an unmocked call would hang the
  // effect rather than silently succeed, which is what the pre-existing
  // tests above rely on to prove this hook stays a no-op without it.
  resolveOrCreateForDataset.mockResolvedValue({
    data: {
      id: 'edit-draft-1',
      name: 'Boiler',
      workspaceId: 'ws-1',
      sourceIds: ['src-1'],
      status: 'ACTIVE',
      currentArtifactId: 'shared-bronze-1',
      savedDatasetId: null,
      editingDatasetId: 'ds-1',
      rootValidationRowCount: null,
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    },
  })
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

  it('DS-LAKE-017-T03: prefers the adopted BRONZE over currentArtifactId (FINAL) — no double-apply, and no version-list round trip', async () => {
    store.set(
      dwEditingDatasetAtom,
      dataset({
        currentArtifactId: 'final-1',
        currentArtifactType: 'FINAL' as never,
        adoptedBronzeArtifactId: 'bronze-1',
      }),
    )

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await waitFor(() => expect(fetchDataset).toHaveBeenCalled())
    // Read the BRONZE id, not the FINAL currentArtifactId — the whole point
    // of T03: replaying Step 3's rules on FINAL is the double-apply DS-LAKE-013
    // could only diagnose (its own banner), not close.
    expect(fetchDataset.mock.calls[0]![1]).toBe('bronze-1')
    expect(store.get(dwRowSourceAtom)).toBe('stored')
    // DS-LAKE-017-T04: proves the fix at the "which stage" boundary.
    // `dwRowStageAtom` is DS-LAKE-013's own banner input — it now reads
    // BRONZE for this case, which is what makes the non-BRONZE banner
    // correctly stay silent. No code change to the banner itself was
    // needed, only a correct stage to read.
    expect(store.get(dwRowStageAtom)).toBe('BRONZE')
    expect(list).not.toHaveBeenCalled()
  })

  it('DS-LAKE-017-T03: falls back to currentArtifactId (FINAL) when no BRONZE has been adopted — case (b)/(c), unchanged from today', async () => {
    store.set(
      dwEditingDatasetAtom,
      dataset({
        currentArtifactId: 'final-1',
        currentArtifactType: 'FINAL' as never,
        adoptedBronzeArtifactId: null,
      }),
    )

    renderHook(() => useDatasetEditHydration(), { wrapper })

    await waitFor(() => expect(fetchDataset).toHaveBeenCalled())
    expect(fetchDataset.mock.calls[0]![1]).toBe('final-1')
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
    expect(resolveOrCreateForDataset).not.toHaveBeenCalled()
  })

  describe('DS-LAKE-024-T03: edit-draft resolution', () => {
    it('resolves the edit draft and points dwDraftIdAtom/dwDraftArtifactIdAtom at its shared BRONZE', async () => {
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('edit-draft-1'))
      expect(resolveOrCreateForDataset).toHaveBeenCalledWith('ds-1')
      expect(store.get(dwDraftArtifactIdAtom)).toBe('shared-bronze-1')
    })

    it('never fires without an editingDatasetId, even in edit mode', async () => {
      store.set(dwEditingDatasetAtom, dataset())
      // dwEditingDatasetIdAtom left at its default ''.

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwRowSourceAtom)).toBe('stored'))
      expect(resolveOrCreateForDataset).not.toHaveBeenCalled()
      expect(store.get(dwDraftIdAtom)).toBeNull()
    })

    it('does not re-resolve once dwDraftIdAtom is already set — idempotent re-entry', async () => {
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')
      store.set(dwDraftIdAtom, 'already-resolved-draft')

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwRowSourceAtom)).toBe('stored'))
      expect(resolveOrCreateForDataset).not.toHaveBeenCalled()
      expect(store.get(dwDraftIdAtom)).toBe('already-resolved-draft')
    })

    it('surfaces a failure via draftError instead of leaving the atoms silently null', async () => {
      resolveOrCreateForDataset.mockRejectedValue(
        new Error(
          'This dataset has no readable raw artifact to edit from — its stored bytes may have been reclaimed.',
        ),
      )
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      const { result } = renderHook(() => useDatasetEditHydration(), {
        wrapper,
      })

      await waitFor(() =>
        expect(result.current.draftError).toMatch(/stored bytes/i),
      )
      expect(store.get(dwDraftIdAtom)).toBeNull()
      expect(store.get(dwDraftArtifactIdAtom)).toBeNull()
    })
  })

  describe('DS-LAKE-024-T04: pristine-root signal', () => {
    it('copies a pristine root (null) onto dwEditRootValidationRowCountAtom', async () => {
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('edit-draft-1'))
      expect(store.get(dwEditRootValidationRowCountAtom)).toBeNull()
    })

    it('copies an already-split root (non-null) onto dwEditRootValidationRowCountAtom', async () => {
      resolveOrCreateForDataset.mockResolvedValue({
        data: {
          id: 'edit-draft-2',
          name: 'Boiler',
          workspaceId: 'ws-1',
          sourceIds: ['src-1'],
          status: 'ACTIVE',
          currentArtifactId: 'shared-bronze-2',
          savedDatasetId: null,
          editingDatasetId: 'ds-1',
          rootValidationRowCount: 42,
          createdAt: '2026-06-22T00:00:00.000Z',
          updatedAt: '2026-06-22T00:00:00.000Z',
        },
      })
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('edit-draft-2'))
      expect(store.get(dwEditRootValidationRowCountAtom)).toBe(42)
    })
  })

  /**
   * DS-LAKE-024-T08, closing openDecisions[3]: "OPENING EDIT ON A DATASET
   * WITH NO ADOPTED BRONZE... Decide which owns it."
   *
   * Resolved as: the ROWS path owns root creation (it already materializes
   * V1 from the saved recipe), and the draft resolves AFTER it. The bug this
   * pins is the race that resolution exposed — the two effects run
   * concurrently, the draft always lost, and nothing ever retried it, so
   * `dwDraftIdAtom` stayed null for the whole session even once a BRONZE
   * existed. A null draft id silently drops edit-mode Save onto the legacy
   * metadata-only branch, which writes no version and no artifact: exactly
   * the defect DS-LAKE-024 exists to remove, surviving in the one case that
   * starts without a root.
   */
  describe('DS-LAKE-024-T08: a dataset that starts with no BRONZE', () => {
    const rootless = () =>
      dataset({ currentVersionId: null, currentArtifactId: null } as never)

    it('retries draft resolution after the rows path materializes its first BRONZE', async () => {
      // First attempt races the materialize and loses — this is the server's
      // own "no raw data stored yet" 422 (DS-LAKE-024-T08, backend).
      resolveOrCreateForDataset.mockRejectedValueOnce(
        new Error('This dataset has no raw data stored yet'),
      )
      store.set(dwEditingDatasetAtom, rootless())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      const { result } = renderHook(() => useDatasetEditHydration(), {
        wrapper,
      })

      // The rows path mints the root...
      await waitFor(() => expect(createRaw).toHaveBeenCalledTimes(1))
      // ...and the draft is retried against it rather than staying null.
      await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('edit-draft-1'))
      expect(resolveOrCreateForDataset).toHaveBeenCalledTimes(2)
      expect(store.get(dwDraftArtifactIdAtom)).toBe('shared-bronze-1')
      // The stale 422 must not still be on screen once the retry succeeded.
      expect(result.current.draftError).toBeNull()
      expect(result.current.rawDataAbsent).toBeNull()
    })

    it('does NOT retry when the dataset already had a BRONZE — one call, no extra round trip', async () => {
      store.set(dwEditingDatasetAtom, dataset())
      store.set(dwEditingDatasetIdAtom, 'ds-1')

      renderHook(() => useDatasetEditHydration(), { wrapper })

      await waitFor(() => expect(store.get(dwDraftIdAtom)).toBe('edit-draft-1'))
      // `rowsSettledOnRealArtifact` flipping true re-runs the effect, but the
      // `draftId` guard returns before it calls anything.
      await waitFor(() => expect(store.get(dwRowSourceAtom)).toBe('stored'))
      expect(resolveOrCreateForDataset).toHaveBeenCalledTimes(1)
      expect(createRaw).not.toHaveBeenCalled()
    })

    it('states that there is no raw data, with the reason, when the recipe cannot be re-fetched', async () => {
      // A CSV's rows only ever existed in the browser, so branch 2 cannot
      // materialize and falls back to synthetic rows — the TERMINAL half of
      // this state, where editing can never produce a version until the user
      // supplies data.
      store.set(
        dwEditingDatasetAtom,
        dataset({
          currentVersionId: null,
          currentArtifactId: null,
          pipelineConfig: {
            ...EMPTY_PIPELINE_CONFIG,
            baseTags: ['TI-101'],
            customDateRange: {
              from: '2026-06-22T00:00',
              to: '2026-06-22T01:00',
            },
            sourceFetchConfigs: { 'src-1': { type: 'csv' } as never },
          },
        } as never),
      )

      const { result } = renderHook(() => useDatasetEditHydration(), {
        wrapper,
      })

      await waitFor(() => expect(result.current.rawDataAbsent).not.toBeNull())
      expect(result.current.rawDataAbsent).toEqual({
        materializing: false,
        reason:
          'Uploaded CSV rows are not stored on the server, so they cannot be re-read.',
      })
      expect(createRaw).not.toHaveBeenCalled()
    })
  })
})
