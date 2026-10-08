import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetCleaningScaleCommit } from '../use-dataset-cleaning-scale-commit'
import { datasetDraftService } from '@/services/dataset-draft'
import { featureRecipeStamp } from '@/lib/feature-engineering'
import {
  dwDraftIdAtom,
  dwDraftFeatureArtifactIdAtom,
  dwFeatureWarmStateAtom,
  dwFeatureArtifactStampAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    clean: vi.fn(),
    job: vi.fn(),
  },
}))

const RECIPE = {
  features: [{ id: 'f1', kind: 'lag' as const, tag: 'TI-101', k: 1 }],
  selectedColumns: null,
  scalers: {},
  targetY: null,
}

/**
 * DS-LAKE-023 (edit-mode re-split pass). `useDatasetCleaningScaleCommit`'s
 * new stale-artifact refusal (AC3/D4, feature_list.preprocessing.json) —
 * `goTo` (the step indicator) never calls `canAdvance`, so a user could
 * reach this commit before Step 4's debounced warm (which produced
 * `dwDraftFeatureArtifactIdAtom`'s CURRENT value) had actually finished for
 * the user's latest edit. This suite covers only that new gate; the
 * pre-existing "no draft/source artifact" guard and the happy-path network
 * call are exercised incidentally by the passing case below.
 */
function renderWithStore(
  overrides: {
    draftId?: string | null
    sourceArtifactId?: string | null
    warmState?: 'idle' | 'pending' | 'ready' | 'error'
    artifactStamp?: string | null
  } = {},
) {
  const store = createStore()
  store.set(
    dwDraftIdAtom,
    overrides.draftId !== undefined ? overrides.draftId : 'draft-1',
  )
  store.set(
    dwDraftFeatureArtifactIdAtom,
    overrides.sourceArtifactId !== undefined
      ? overrides.sourceArtifactId
      : 'silver-1',
  )
  store.set(dwFeatureWarmStateAtom, overrides.warmState ?? 'ready')
  store.set(
    dwFeatureArtifactStampAtom,
    overrides.artifactStamp !== undefined
      ? overrides.artifactStamp
      : featureRecipeStamp({ ...RECIPE, holdout: null }),
  )
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  return renderHook(() => useDatasetCleaningScaleCommit(), { wrapper })
}

describe('useDatasetCleaningScaleCommit — DS-LAKE-023 stale-artifact refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses when the feature warm is still pending, even if a source artifact already exists', async () => {
    const { result } = renderWithStore({ warmState: 'pending' })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.commit({}, RECIPE)
    })

    expect(ok).toBe(false)
    expect(datasetDraftService.clean).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toMatch(/catching up/i)
  })

  it("refuses when the committed artifact's stamp does not match the CURRENT recipe — a holdout Applied after the artifact landed", async () => {
    // Stamp on the atom reflects an OLDER recipe (no holdout) than what the
    // caller now passes (a holdout has since been applied) — simulates
    // exactly the D4 race: Step 4's warm already landed for the PREVIOUS
    // recipe, then the user Applied a holdout and jumped to Step 5 via the
    // step indicator before the NEW warm (for the holdout) had landed.
    const { result } = renderWithStore({
      artifactStamp: featureRecipeStamp({ ...RECIPE, holdout: null }),
    })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.commit(
        {},
        { ...RECIPE, holdout: { from: '2026-01-16', to: '2026-01-20' } },
      )
    })

    expect(ok).toBe(false)
    expect(datasetDraftService.clean).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toMatch(/catching up/i)
  })

  it('commits when the warm is ready AND the stamp matches the current recipe', async () => {
    vi.mocked(datasetDraftService.clean).mockResolvedValue({
      data: { jobId: 'job-1', status: 'QUEUED' },
    } as never)
    vi.mocked(datasetDraftService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: 'gold-1', error: null },
    } as never)
    const { result } = renderWithStore()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.commit({}, RECIPE)
    })

    expect(ok).toBe(true)
    expect(datasetDraftService.clean).toHaveBeenCalledWith(
      'draft-1',
      'silver-1',
      expect.objectContaining({ operations: [] }),
    )
    expect(result.current.state.status).toBe('committed')
  })

  it('still refuses (pre-existing guard, unaffected by this pass) when there is no source artifact yet', async () => {
    const { result } = renderWithStore({ sourceArtifactId: null })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.commit({}, RECIPE)
    })

    expect(ok).toBe(false)
    expect(datasetDraftService.clean).not.toHaveBeenCalled()
  })
})
