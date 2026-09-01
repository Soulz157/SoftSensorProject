import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useModelPipelineNav } from '@/hooks/model/use-model-pipeline-nav'
import { Phase3TrainingConfig } from '../phase-3-training-config'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import {
  mpHighestUnlockedAtom,
  mpSelectedDatasetAtom,
  mpTargetVariableAtom,
  mpTrainStateAtom,
  mpTrainTestSplitAtom,
  mpAlgorithmsAtom,
  mpWorkspaceIdAtom,
} from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import type { DraftSplitStatsResult } from '@/services/dataset-version'

/**
 * MODEL-FLOW-014-T08/V07/V08. Nothing rendered `Phase3TrainingConfig`
 * before this — the hook-level suite (use-run-config-draft.test.tsx) proves
 * the draft/apply/relock mechanism in isolation, but only a render through
 * the real component proves it is actually WIRED that way: specifically
 * that `SplitDistributionPanel` keeps reading the COMMITTED ratio (not the
 * local draft the slider writes to), which is what makes "no fetch per
 * keystroke" true rather than merely asserted.
 *
 * Only the two network-touching services are mocked; `useRunConfigDraft`,
 * `useModelDraftSync`, `useCommitRunConfig` and the rendered controls all
 * run for real against this test's own jotai store — same discipline
 * run-params-panel.test.tsx already established for this wizard.
 */

const h = vi.hoisted(() => ({
  splitStats: vi.fn(),
  draftCreate: vi.fn(),
  draftPatch: vi.fn(),
  runsList: vi.fn(),
}))

vi.mock('@/services/dataset-version', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/dataset-version')>()
  return {
    ...actual,
    datasetArtifactService: {
      ...actual.datasetArtifactService,
      splitStats: h.splitStats,
    },
  }
})

vi.mock('@/services/model-draft', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/model-draft')>()
  return {
    ...actual,
    modelDraftService: {
      ...actual.modelDraftService,
      create: h.draftCreate,
      patch: h.draftPatch,
    },
    modelDraftRunService: {
      ...actual.modelDraftRunService,
      list: h.runsList,
    },
  }
})

let store: ReturnType<typeof createStore>

const DATASET: SavedDataset = {
  id: 'ds-1',
  name: 'Dataset 1',
  workspaceId: 'ws-1',
  tags: ['TI-101', 'PI-201'],
  rowCount: 1000,
  currentArtifactId: 'art-1',
  currentArtifactType: 'FINAL',
} as SavedDataset

/** "Cut at <date> — N train / M test labelled rows" — the date sits in its
 * own nested `<span>`, splitting the sentence across text nodes (same trap
 * as T07's SeedControl copy), so match on the containing element's
 * combined textContent instead of a single getByText regex. */
function hasLabelledRowsText(
  el: Element | null,
  train: number,
  test: number,
): boolean {
  return Boolean(
    el?.textContent?.includes(`${train} train`) &&
    el.textContent.includes(`${test} test`),
  )
}

/** Every ancestor of the matching text ALSO "contains" it as descendant
 * text, so getByText would otherwise report multiple matches — narrow to
 * the one leaf element whose own children don't already match. */
function labelledRowsMatcher(train: number, test: number) {
  return (_content: string, element: Element | null): boolean =>
    hasLabelledRowsText(element, train, test) &&
    Array.from(element?.children ?? []).every(
      child => !hasLabelledRowsText(child, train, test),
    )
}

function findLabelledRowsText(train = 800, test = 200) {
  return screen.findByText(labelledRowsMatcher(train, test))
}

function splitStatsResponse(
  overrides: Partial<DraftSplitStatsResult> = {},
): DraftSplitStatsResult {
  return {
    source_key: 'ds-1/art-1/data.parquet',
    target_y: 'TI-101',
    split_ratio: 0.8,
    cut_timestamp: '2026-06-01T00:00:00.000Z',
    train_labelled_rows: 800,
    test_labelled_rows: 200,
    source_rows: 1000,
    train: { tags: [], insufficient_tags: [] },
    test: { tags: [], insufficient_tags: [] },
    ...overrides,
  }
}

function Harness() {
  const nav = useModelPipelineNav()
  return <Phase3TrainingConfig nav={nav} />
}

beforeEach(() => {
  store = createStore()
  clearChartRequestCache()
  // Varies by the REQUESTED ratio, not a constant — V03 requires proving
  // the rendered cut/row counts actually move when a new ratio is applied,
  // which a fixed response can't distinguish from a client-side no-op.
  h.splitStats.mockReset().mockImplementation(async (_ds, _art, body) => ({
    data:
      body.splitRatio === 0.7
        ? splitStatsResponse({
            split_ratio: 0.7,
            cut_timestamp: '2026-05-01T00:00:00.000Z',
            train_labelled_rows: 700,
            test_labelled_rows: 300,
          })
        : splitStatsResponse(),
    statusCode: 200,
    message: 'ok',
    type: 'success',
  }))
  h.draftCreate.mockReset().mockResolvedValue({
    data: { id: 'draft-1' },
    statusCode: 201,
    message: 'ok',
    type: 'success',
  })
  h.draftPatch.mockReset().mockResolvedValue({
    data: { id: 'draft-1' },
    statusCode: 200,
    message: 'ok',
    type: 'success',
  })
  h.runsList.mockReset().mockResolvedValue({
    data: [],
    statusCode: 200,
    message: 'ok',
    type: 'success',
  })

  store.set(mpWorkspaceIdAtom, 'ws-1')
  store.set(mpSelectedDatasetAtom, DATASET)
  store.set(mpTargetVariableAtom, ['TI-101'])
  store.set(mpAlgorithmsAtom, ['ols'])
  store.set(mpTrainTestSplitAtom, 80)
})

function renderStep3() {
  return render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  )
}

describe('Phase3TrainingConfig — the draft-sync mount flush', () => {
  it('flushes on mount even with zero edits, seeding the server draft row (replaces autoSync’s old mount PATCH)', async () => {
    renderStep3()

    await waitFor(() => expect(h.draftCreate).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })
    await waitFor(() => expect(h.draftPatch).toHaveBeenCalled(), {
      timeout: 2000,
    })
    // `flush`'s identity itself changes once `ensureDraftId`'s create
    // resolves (its own deps include the now-set draftId), so the mount
    // effect below can settle after more than one call — all of them
    // carrying the SAME committed content until something actually edits
    // it. Wait for that settling before reading a steady-state count.
    await new Promise(resolve => setTimeout(resolve, 200))
    const settledCalls = h.draftPatch.mock.calls.length
    const lastMountBody = h.draftPatch.mock.calls.at(-1)![1]
    expect(lastMountBody.targetY).toBe('TI-101')
    expect(lastMountBody.algorithm).toBe('ols')
    expect(lastMountBody.splitRatio).toBe(0.8)

    // Editing without applying must NOT trigger another PATCH — autoSync is
    // off; only the mount flush(es) above and a future Apply write the row.
    fireEvent.click(screen.getByRole('radio', { name: '70:30' }))
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(h.draftPatch).toHaveBeenCalledTimes(settledCalls)
  })

  it('Apply flushes the newly-applied config to the same draft row', async () => {
    renderStep3()
    await waitFor(() => expect(h.draftPatch).toHaveBeenCalled(), {
      timeout: 2000,
    })
    await new Promise(resolve => setTimeout(resolve, 200)) // let mount settle

    fireEvent.click(screen.getByRole('radio', { name: '70:30' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(
      () => {
        const bodies = h.draftPatch.mock.calls.map(c => c[1])
        expect(bodies.some(b => b.splitRatio === 0.7)).toBe(true)
      },
      { timeout: 2000 },
    )
  })
})

describe('Phase3TrainingConfig — V07: Apply gates the split-stats fetch and the relock', () => {
  it('dragging the ratio fetches nothing and does not relock; Apply does both, once', async () => {
    store.set(mpHighestUnlockedAtom, 5)
    store.set(mpTrainStateAtom, { status: 'idle', progress: 0 })
    renderStep3()

    // Initial mount fetch, for the committed ratio (80).
    await waitFor(() => expect(h.splitStats).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })
    const afterMount = h.splitStats.mock.calls.length

    // Move the split via a preset toggle — writes the DRAFT only.
    fireEvent.click(screen.getByRole('radio', { name: '70:30' }))
    expect(await screen.findByText(/Unapplied changes/)).toBeInTheDocument()

    // Give the debounced hook a full window to prove it does NOT fire.
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(h.splitStats).toHaveBeenCalledTimes(afterMount)
    expect(store.get(mpHighestUnlockedAtom)).toBe(5)

    // Apply.
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(store.get(mpHighestUnlockedAtom)).toBe(3)
    expect(store.get(mpTrainTestSplitAtom)).toBe(70)

    await waitFor(
      () => expect(h.splitStats).toHaveBeenCalledTimes(afterMount + 1),
      { timeout: 2000 },
    )
    // The fetch that landed used the NEWLY committed ratio, not the stale one.
    const lastCallBody = h.splitStats.mock.calls.at(-1)![2]
    expect(lastCallBody.splitRatio).toBe(0.7)

    // V03 (amended for post-T08): cut timestamp and both row counts
    // actually move on screen, not just the request — the mock varies its
    // response by requested ratio precisely so a client-side no-op can't
    // pass this.
    expect(await findLabelledRowsText(700, 300)).toBeInTheDocument()
  })

  it('editing without applying leaves Start Training disabled and the applied split on screen', async () => {
    store.set(mpTrainStateAtom, { status: 'idle', progress: 0 })
    renderStep3()

    await waitFor(() => expect(h.splitStats).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })
    expect(await findLabelledRowsText()).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '70:30' }))

    // Start Training is disabled while dirty — canTrain &&= !dirty.
    expect(
      screen.getByRole('button', { name: /Start Training/ }),
    ).toBeDisabled()
    // The panel still describes the APPLIED split — trap: it must not read
    // the draft ratio, or this would already say 700/300 before Apply.
    expect(screen.getByText(labelledRowsMatcher(800, 200))).toBeInTheDocument()
  })
})

describe('Phase3TrainingConfig — V08: Evaluation reachability gates on Apply, not on edit', () => {
  it('a completed run stays reachable through an unapplied edit, and relocks once Apply lands', async () => {
    store.set(mpTrainStateAtom, { status: 'done', progress: 100 })
    store.set(mpHighestUnlockedAtom, 5)
    renderStep3()

    await waitFor(() => expect(h.splitStats).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })

    fireEvent.click(screen.getByRole('radio', { name: '70:30' }))
    // Edited but not applied — Evaluation (unlocked at 5) stays reachable.
    expect(store.get(mpHighestUnlockedAtom)).toBe(5)
    expect(store.get(mpTrainStateAtom).status).toBe('done')

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // Applied — relocked to Training Config, no longer reachable past it.
    expect(store.get(mpHighestUnlockedAtom)).toBe(3)
    expect(store.get(mpTrainStateAtom)).toEqual({
      status: 'idle',
      progress: 0,
    })
  })
})
