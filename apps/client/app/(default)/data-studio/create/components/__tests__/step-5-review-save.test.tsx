import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwFeatureConfigsAtom,
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

const validateArtifact = vi.fn()
const finalizeArtifact = vi.fn()
const saveDraft = vi.fn()
const fetchMetadata = vi.fn()
vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    validate: (...args: unknown[]) => validateArtifact(...args),
    finalize: (...args: unknown[]) => finalizeArtifact(...args),
    save: (...args: unknown[]) => saveDraft(...args),
    metadata: (...args: unknown[]) => fetchMetadata(...args),
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
  // Unused unless a test sets dwDraftIdAtom/dwDraftArtifactIdAtom — the gate
  // stays 'unavailable' otherwise, matching every pre-T02 test's assumption.
  validateArtifact.mockResolvedValue({
    data: {
      status: 'PASS',
      quality_score: 100,
      checks: [],
      failed_checks: [],
      advisory_failures: [],
      validation_report_key: 'k',
    },
  })
  finalizeArtifact.mockResolvedValue({ data: { id: 'final-1' } })
  // DS-LAKE-005B-B-T01 (Step 5 leg). Default so tests that reach the draft
  // path without asserting on metadata content still settle into a resolved
  // state rather than staying `pending` — same reasoning as `validateArtifact`'s
  // own default PASS above. Individual tests override this when the
  // metadata VALUE itself is what's under test.
  fetchMetadata.mockResolvedValue({
    data: {
      id: 'final-1',
      runId: 'run-1',
      type: 'FINAL',
      parentArtifactId: 'gold-1',
      checksum: 'c'.repeat(64),
      rowCount: 100,
      tagCount: 3,
      columnCount: 7,
      missingPct: 1.2,
      sizeBytes: '4096',
      tags: ['TI-101', 'PI-303', 'FI-201'],
      startTime: '2026-06-22T00:00:00Z',
      endTime: '2026-06-22T01:00:00Z',
      createdAt: '2026-06-22T01:05:00Z',
    },
  })
  saveDraft.mockResolvedValue({
    data: {
      id: 'ds-1',
      versionId: 'ver-1',
      versionNumber: 1,
      artifactId: 'final-1',
      qualityScore: 100,
      lineage: [],
    },
  })
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

describe('Step5ReviewSave — validation gate (DS-LAKE-008-T02)', () => {
  const withGateArtifact = () => {
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwDraftArtifactIdAtom, 'silver-1')
  }

  it('disables Save and states the reason while validation is pending', async () => {
    let resolveValidate!: (v: unknown) => void
    validateArtifact.mockReturnValue(
      new Promise(r => {
        resolveValidate = r
      }),
    )
    withGateArtifact()

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(screen.getByRole('button', { name: /save dataset/i })).toBeDisabled()
    expect(screen.getByText(/waiting for validation to finish/i)).toBeVisible()

    // Resolve so the pending promise doesn't leak into the next test.
    resolveValidate({
      data: {
        status: 'PASS',
        quality_score: 100,
        checks: [],
        failed_checks: [],
        advisory_failures: [],
        validation_report_key: 'k',
      },
    })
  })

  it('disables Save, states the reason, and writes nothing when validation FAILS', async () => {
    validateArtifact.mockResolvedValue({
      data: {
        status: 'FAIL',
        quality_score: 80,
        checks: [],
        failed_checks: ['missing_values'],
        advisory_failures: [],
        validation_report_key: 'k',
      },
    })
    createDataset.mockResolvedValue(saved(null))
    withGateArtifact()

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    const button = await screen.findByRole('button', {
      name: /save dataset/i,
    })
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByText(/fix the failed check\(s\) above/i)).toBeVisible()

    // V03: the FAIL path must write NOTHING — Dataset, DatasetArtifact
    // (via createFeatures/materialize) or DatasetVersion (via createRaw).
    // A disabled button already stops a real click; this proves handleSave
    // itself also refuses, so a bypassed disabled attribute (e.g. a
    // programmatic dispatch in a future regression) can't slip through.
    expect(createDataset).not.toHaveBeenCalled()
    expect(createRaw).not.toHaveBeenCalled()
  })

  it('re-enables Save once validation resolves to PASS', async () => {
    withGateArtifact() // beforeEach's default mock resolves PASS

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save dataset/i }),
      ).toBeEnabled(),
    )
    expect(
      screen.queryByText(/waiting for validation to finish/i),
    ).not.toBeInTheDocument()
  })

  it('leaves Save enabled when no draft artifact exists yet (unavailable, not blocking)', () => {
    // No dwDraftIdAtom/dwDraftArtifactIdAtom set — same state every
    // pre-T02 test in this file already exercises, and edit mode's own
    // permanent state (use-dataset-edit-hydration.ts never sets these).
    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(screen.getByRole('button', { name: /save dataset/i })).toBeEnabled()
    expect(validateArtifact).not.toHaveBeenCalled()
  })
})

describe('Step5ReviewSave — advisory gate (DS-LAKE-019-T04)', () => {
  const withGateArtifact = () => {
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwDraftArtifactIdAtom, 'silver-1')
  }

  it('shows a prominent advisory banner naming the check and its tags, and leaves Save enabled', async () => {
    validateArtifact.mockResolvedValue({
      data: {
        status: 'PASS',
        quality_score: 90,
        checks: [
          {
            name: 'statistical',
            passed: false,
            skipped: false,
            detail: '2 tag(s) over the outlier-fraction threshold.',
            measured: 18.1,
            threshold: 10,
            offenders: ['TI-101', 'TI-207'],
            severity: 'advisory',
          },
        ],
        failed_checks: ['statistical'],
        advisory_failures: ['statistical'],
        validation_report_key: 'k',
      },
    })
    withGateArtifact()

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    // Save is NOT blocked by an advisory-only failure.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save dataset/i }),
      ).toBeEnabled(),
    )

    // The advisory is named, with its measured value, threshold and
    // offending tags — not just a generic "1 check failed" line. The label
    // legitimately appears twice (the existing per-check row AND the new
    // banner), so this asserts at least one is visible rather than exactly
    // one; the measured/threshold/tags line is unique to the banner.
    expect(screen.getAllByText(/statistical outliers/i).length).toBeGreaterThan(
      0,
    )
    expect(screen.getByText(/measured 18\.1, threshold 10/i)).toBeVisible()
    expect(screen.getByText(/TI-101, TI-207/)).toBeVisible()
  })

  it('renders no advisory banner for a clean PASS with no advisory failures', async () => {
    withGateArtifact() // beforeEach's default mock resolves PASS, advisory_failures: []

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save dataset/i }),
      ).toBeEnabled(),
    )
    expect(screen.queryByText(/data-quality advisor/i)).not.toBeInTheDocument()
  })
})

describe('Step5ReviewSave — recipe-change revalidation (DS-LAKE-008-T03)', () => {
  const withGateArtifact = () => {
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwDraftArtifactIdAtom, 'silver-1')
  }

  it('revalidates when a recipe field changes, without waiting for a new artifact id', async () => {
    withGateArtifact()

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    await waitFor(() => expect(validateArtifact).toHaveBeenCalledTimes(1))

    act(() => {
      store.set(dwFeatureConfigsAtom, [
        { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
      ] as never)
    })

    await waitFor(() => expect(validateArtifact).toHaveBeenCalledTimes(2))
    // Same artifact id both calls — proves this fired from T03's recipe
    // watcher, not from T01's gateArtifactId-rotation path (that path is
    // covered separately by use-dataset-validation.test.ts).
    expect(validateArtifact).toHaveBeenNthCalledWith(
      2,
      'draft-1',
      'silver-1',
      {},
    )
  })

  it('re-disables Save immediately on a recipe change after a PASS, before revalidation resolves (DS-LAKE-008-V01)', async () => {
    withGateArtifact() // beforeEach's default validateArtifact mock resolves PASS
    // DS-LAKE-005B-B-T01. This test is about validation staleness, not
    // GOLD-readiness — set so the mid-test dwFeatureConfigsAtom change below
    // doesn't ALSO trip the new goldNotReady guard and swap the asserted
    // "waiting for validation" message for "waiting for feature engineering".
    store.set(dwDraftGoldArtifactIdAtom, 'gold-1')

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    const button = await screen.findByRole('button', { name: /save dataset/i })
    await waitFor(() => expect(button).toBeEnabled())

    // A stale PASS must not survive the edit: disabled the instant the
    // recipe changes, not only after the new validate() call resolves.
    let resolveSecond!: (v: unknown) => void
    validateArtifact.mockReturnValueOnce(
      new Promise(r => {
        resolveSecond = r
      }),
    )
    act(() => {
      store.set(dwFeatureConfigsAtom, [
        { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
      ] as never)
    })

    expect(button).toBeDisabled()
    expect(screen.getByText(/waiting for validation to finish/i)).toBeVisible()

    resolveSecond({
      data: {
        status: 'PASS',
        quality_score: 100,
        checks: [],
        failed_checks: [],
        advisory_failures: [],
        validation_report_key: 'k',
      },
    })
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('does not double-fire on mount', async () => {
    withGateArtifact()

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    await waitFor(() => expect(validateArtifact).toHaveBeenCalledTimes(1))

    // Let any effect scheduled for mount settle; count must stay at 1 — the
    // recipe watcher's first-render guard exists specifically to stop it
    // from re-running T01's own initial validation a second time.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(validateArtifact).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a recipe change when there is no gate artifact', () => {
    // Unavailable stays unavailable — nothing to revalidate against.
    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    act(() => {
      store.set(dwFeatureConfigsAtom, [
        { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
      ] as never)
    })

    expect(validateArtifact).not.toHaveBeenCalled()
  })
})

describe('Step5ReviewSave — artifact-adoption save (DS-LAKE-005B-B-T01, Step 5 leg)', () => {
  const withGateArtifact = () => {
    store.set(dwDraftIdAtom, 'draft-1')
    store.set(dwDraftArtifactIdAtom, 'silver-1')
  }

  it('finalizes then saves via the draft — never touches the legacy create/createRaw path', async () => {
    withGateArtifact()
    await clickSave()

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    expect(finalizeArtifact).toHaveBeenCalledWith('draft-1', 'silver-1', {})
    expect(saveDraft).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ name: 'Boiler' }),
    )
    expect(createDataset).not.toHaveBeenCalled()
    expect(updateDataset).not.toHaveBeenCalled()
    expect(createRaw).not.toHaveBeenCalled()
  })

  it('reuses the FINAL artifact from the first finalize call on a retry, rather than minting a second one', async () => {
    withGateArtifact()
    // First attempt's save fails (e.g. a name collision) — `saved` stays
    // false, so a second click is a real, reachable retry, not a click on
    // a permanently-disabled "Saved" button.
    saveDraft.mockRejectedValueOnce(new Error('name collision'))

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    const button = await screen.findByRole('button', { name: /save dataset/i })
    await waitFor(() => expect(button).toBeEnabled())

    await userEvent.click(button)
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    expect(finalizeArtifact).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button).toBeEnabled())

    await userEvent.click(button)
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))

    // Still only ONE finalize call — the cached FINAL id was reused.
    expect(finalizeArtifact).toHaveBeenCalledTimes(1)
  })

  it('edit mode still calls datasetService.update and never touches the new draft-save path', async () => {
    store.set(dwModeAtom, 'edit')
    // No draftId/gateArtifactId — edit mode never sets these in production
    // (use-dataset-edit-hydration.ts never writes them, per T01's own doc
    // comment), so this is the realistic case, not a hypothetical one.
    updateDataset.mockResolvedValue(saved('artifact-1'))

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateDataset).toHaveBeenCalledTimes(1))
    expect(finalizeArtifact).not.toHaveBeenCalled()
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('a create-mode flow with no draft (e.g. CSV-only) still takes the legacy create path', async () => {
    // No dwDraftIdAtom/dwDraftArtifactIdAtom set.
    createDataset.mockResolvedValue(saved(null))

    await clickSave()

    await waitFor(() => expect(createDataset).toHaveBeenCalledTimes(1))
    expect(finalizeArtifact).not.toHaveBeenCalled()
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('surfaces a toast and leaves the dataset unsaved when the save call rejects', async () => {
    withGateArtifact()
    saveDraft.mockRejectedValue(new Error('quota exceeded'))

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /save dataset/i }))

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    // Save button text reverts — never shows the "Saved" state.
    expect(
      screen.queryByRole('button', { name: /saved/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /save dataset/i }),
    ).toBeInTheDocument()
  })

  it('blocks Save when a feature recipe exists but GOLD has not been produced yet', async () => {
    withGateArtifact()
    store.set(dwFeatureConfigsAtom, [
      { id: 'f1', kind: 'lag', tag: 'TI-101', k: 1 },
    ] as never)
    // dwDraftGoldArtifactIdAtom deliberately left unset.

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    const button = await screen.findByRole('button', { name: /save dataset/i })
    expect(button).toBeDisabled()
    expect(
      screen.getByText(/waiting for feature engineering to finish/i),
    ).toBeVisible()
  })

  // DS-LAKE-005B-B-T01 (Step 5 leg). `raw` is set to a NON-trivial dataset
  // (5 tags, 7 rows) that this fixture's trivial recipe (no features/crop/
  // exclusions, selectedColumns null) would reproduce almost unchanged if
  // the client pipeline ran — so a tile showing 5/7 would mean the pipeline
  // ran; showing the default fetchMetadata fixture's 3/100 instead proves
  // it did not. Scoped precisely to what this proves: Step 5's OWN
  // `useMemo` transform chain did not run — `use-dataset-pipeline-nav.ts`'s
  // separate `canAdvance` pipeline (a different consumer of `nav`, not
  // exercised by this fixture) is untouched by this change and this test
  // makes no claim about it.
  it('reads Tags/Rows tiles from artifact metadata, not the client pipeline, on the draft path', async () => {
    withGateArtifact()
    act(() => {
      store.set(dwRawDatasetAtom, {
        tags: ['A', 'B', 'C', 'D', 'E'],
        rows: Array.from({ length: 7 }, (_, i) => ({
          timestamp: `t${i}`,
          cells: {},
        })),
      })
    })

    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    await waitFor(() => expect(fetchMetadata).toHaveBeenCalled())
    expect(await screen.findByText('3')).toBeInTheDocument() // Tags: metadata.tagCount
    expect(screen.getByText('100')).toBeInTheDocument() // Rows: metadata.rowCount
    expect(screen.getByText('7')).toBeInTheDocument() // Raw rows: unaffected, still raw.rows.length
    expect(screen.queryByText('5')).not.toBeInTheDocument() // would appear if the pipeline ran
  })

  it('omits tags from the save request on the draft path — the server derives it from the artifact', async () => {
    withGateArtifact()
    await clickSave()

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    const [, body] = saveDraft.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(body).not.toHaveProperty('tags')
  })

  it('target-missing banner reads metadata.tags on the draft path — warns when metadata confirms absence', async () => {
    withGateArtifact()
    store.set(dwTargetTagAtom, 'LAB-999') // absent from the default fetchMetadata fixture's tags
    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    expect(await screen.findByText(/is not in this dataset/i)).toBeVisible()
  })

  it('target-missing banner reads metadata.tags on the draft path — silent once metadata confirms presence', async () => {
    withGateArtifact()
    store.set(dwTargetTagAtom, 'TI-101') // present in the default fetchMetadata fixture's tags
    render(
      <Provider store={store}>
        <Step5ReviewSave nav={nav} />
      </Provider>,
    )

    await waitFor(() => expect(fetchMetadata).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByText(/is not in this dataset/i),
      ).not.toBeInTheDocument(),
    )
  })
})
