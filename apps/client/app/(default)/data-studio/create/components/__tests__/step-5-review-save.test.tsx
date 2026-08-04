import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { Step5ReviewSave } from '../step-5-review-save'
import {
  dwNameAtom,
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwSourceFetchConfigsAtom,
  dwCustomDateRangeAtom,
  dwRawDatasetAtom,
  dwModeAtom,
} from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

/**
 * The Save path is what actually answers "no .parquet appears in MinIO", and
 * until this file existed it was the ONE piece of the slice with no test: the
 * endpoint was proven by curl, which says nothing about whether the BUTTON
 * calls it. Same shape as the F2 finding, where every parity guarantee ran
 * through a route the production entry point never used.
 *
 * Pinned here: the branch condition and the request it builds — the two things
 * a later refactor can break silently, because a dataset with no stored
 * artifact still renders a perfectly convincing screen.
 */

const createDataset = vi.fn()
const updateDataset = vi.fn()
const createRaw = vi.fn()

vi.mock('@/services/dataset', () => ({
  datasetService: {
    create: (...args: unknown[]) => createDataset(...args),
    update: (...args: unknown[]) => updateDataset(...args),
  },
}))

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    createRaw: (...args: unknown[]) => createRaw(...args),
  },
}))

const toastWarning = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

/** Only the fields `Step5ReviewSave` destructures are needed. */
const nav = {
  cropRange: null,
  valueCrop: {},
  exclusions: [],
  conditionalRules: [],
  statisticalRules: [],
  selectedColumns: null,
  scalerConfigs: {},
} as unknown as UseDatasetPipelineNavResult

const saved = (currentVersionId: string | null) => ({
  data: { id: 'ds-1', name: 'Boiler', currentVersionId },
})

let store: ReturnType<typeof createStore>

beforeEach(() => {
  vi.clearAllMocks()
  store = createStore()
  store.set(dwNameAtom, 'Boiler')
  store.set(dwWorkspaceIdAtom, 'ws-1')
  store.set(dwModeAtom, 'create')
  store.set(dwSelectedTagsAtom, ['TI-101', 'PI-303'])
  store.set(dwSourceFetchConfigsAtom, { 'src-1': { type: 'pi' } as never })
  store.set(dwCustomDateRangeAtom, {
    from: '2026-06-22T00:00',
    to: '2026-06-22T01:00',
  })
  store.set(dwSelectedSourcesAtom, [])
  store.set(dwRawDatasetAtom, { tags: [], rows: [] })
  createRaw.mockResolvedValue({ data: { id: 'ver-1' } })
})

const clickSave = async () => {
  render(
    <Provider store={store}>
      <Step5ReviewSave nav={nav} />
    </Provider>,
  )
  await userEvent.click(screen.getByRole('button', { name: /save dataset/i }))
}

describe('Step5ReviewSave — storing rows on save', () => {
  it('materialises the artifact after creating a dataset', async () => {
    createDataset.mockResolvedValue(saved(null))

    await clickSave()

    await waitFor(() => expect(createRaw).toHaveBeenCalledTimes(1))
    // The exact payload matters: `toPiTime` must turn the stored
    // 'YYYY-MM-DDTHH:mm' into the connector's 'YYYY-MM-DD HH:mm:ss', and the
    // tags must be baseTags (pre feature-engineering), not the saved `tags`.
    expect(createRaw).toHaveBeenCalledWith('ds-1', {
      sourceId: 'src-1',
      tags: ['TI-101', 'PI-303'],
      startTime: '2026-06-22 00:00:00',
      endTime: '2026-06-22 01:00:00',
    })
  })

  it('does NOT re-materialise a dataset that already has a version', async () => {
    // The edit-save case. Re-running it would mint a redundant second RAW
    // version: the recipe may have changed, the source window did not.
    createDataset.mockResolvedValue(saved('ver-existing'))

    await clickSave()

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1))
    expect(createRaw).not.toHaveBeenCalled()
  })

  it('keeps the dataset when the fetch fails, and says so', async () => {
    // The row is already committed. Failing the save over the artifact would
    // discard the user's recipe for something the next Edit-open retries, so
    // the failure is reported and the save still completes.
    createDataset.mockResolvedValue(saved(null))
    createRaw.mockRejectedValue(new Error('PI unreachable'))

    await clickSave()

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1))
    expect(toastWarning.mock.calls[0]![0]).toMatch(/PI unreachable/)
  })

  it('skips materialising a source that cannot be re-read', async () => {
    createDataset.mockResolvedValue(saved(null))
    store.set(dwSourceFetchConfigsAtom, { 'src-1': { type: 'csv' } as never })

    await clickSave()

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1))
    expect(createRaw).not.toHaveBeenCalled()
  })
})
