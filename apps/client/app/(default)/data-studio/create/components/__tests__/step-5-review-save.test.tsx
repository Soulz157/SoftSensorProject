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
  dwFeaturePresetAtom,
  dwTargetTagAtom,
} from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import type { PresetSummary } from '@/lib/feature-preset'

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

/**
 * DS-LAKE-004 moved the re-materialise gate from `currentVersionId` to
 * `currentArtifactId`. `currentVersionId` stays null until Save Dataset creates
 * a version, so gating on it would re-fetch the whole source window on every
 * edit-save. Both pointers are set so the fixture matches a real response.
 */
const saved = (currentArtifactId: string | null) => ({
  data: {
    id: 'ds-1',
    name: 'Boiler',
    currentVersionId: null,
    currentArtifactId,
  },
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

  it('does NOT re-materialise a dataset that already has an artifact', async () => {
    // The edit-save case. Re-running it would mint a redundant second BRONZE
    // artifact: the recipe may have changed, the source window did not.
    createDataset.mockResolvedValue(saved('artifact-existing'))

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

const SUMMARY: PresetSummary = {
  id: 'row-1',
  presetId: 'u-101-no1',
  unit: 'U-101',
  configNo: 1,
  name: 'U-101 No.1 — U101FBP.lab',
  samplingPoint: 'RU-101 Overhead',
  targetY: 'U101FBP.lab',
  objectKey: 'feature-presets/ws-1/imp-1/u-101-no1.json',
  equationCount: 1,
  rawTagCount: 0,
  requiredBaseTags: ['GG001.PV'],
  incomplete: false,
}

describe('Step5ReviewSave — feature preset provenance', () => {
  it('shows which preset the dataset was built from', () => {
    store.set(dwFeaturePresetAtom, SUMMARY)

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(screen.getByText(/built from preset/i)).toBeVisible()
    expect(screen.getByText(SUMMARY.name)).toBeVisible()
  })

  it('renders nothing about a preset when none was applied', () => {
    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(screen.queryByText(/built from preset/i)).not.toBeInTheDocument()
  })

  it('warns loudly, but leaves Save enabled, when the target is not in the dataset', () => {
    // The one invariant this whole feature exists to protect: a preset with
    // every X and no Y must not be silently saveable AS IF complete, but the
    // wizard legitimately supports joining lab Y later — so Save must not be
    // blocked either.
    store.set(dwTargetTagAtom, 'U101FBP.lab')
    store.set(dwRawDatasetAtom, { tags: ['GG001.PV'], rows: [] })

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(screen.getByText(/is not in this dataset/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /save dataset/i })).toBeEnabled()
  })

  it('does not warn when the target is already in the dataset', () => {
    store.set(dwTargetTagAtom, 'U101FBP.lab')
    store.set(dwRawDatasetAtom, {
      tags: ['GG001.PV', 'U101FBP.lab'],
      rows: [],
    })

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(
      screen.queryByText(/is not in this dataset/i),
    ).not.toBeInTheDocument()
  })

  it('persists preset provenance and target into the saved recipe', async () => {
    createDataset.mockResolvedValue(saved(null))
    store.set(dwFeaturePresetAtom, SUMMARY)
    store.set(dwTargetTagAtom, 'U101FBP.lab')

    await clickSave()

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1))
    const body = createDataset.mock.calls[0]![0] as {
      pipelineConfig: { featurePreset?: PresetSummary; targetTag?: string }
    }
    expect(body.pipelineConfig.featurePreset).toEqual(SUMMARY)
    expect(body.pipelineConfig.targetTag).toBe('U101FBP.lab')
  })

  it('omits both fields from the recipe when no preset was applied', async () => {
    createDataset.mockResolvedValue(saved(null))

    await clickSave()

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1))
    const body = createDataset.mock.calls[0]![0] as {
      pipelineConfig: { featurePreset?: PresetSummary; targetTag?: string }
    }
    expect(body.pipelineConfig.featurePreset).toBeUndefined()
    expect(body.pipelineConfig.targetTag).toBeUndefined()
  })
})
