import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { useDatasetValidation } from '../use-dataset-validation'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
} from '@/store/dataset-studio'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: {
    validate: vi.fn(),
  },
}))

const PASS_REPORT = {
  status: 'PASS' as const,
  quality_score: 100,
  checks: [],
  failed_checks: [],
  validation_report_key: 'ds-1/artifacts/gold-1/validation_report.json',
}

const FAIL_REPORT = {
  ...PASS_REPORT,
  status: 'FAIL' as const,
  quality_score: 80,
  failed_checks: ['missing_values'],
}

function renderWithStore(opts: {
  draftId?: string | null
  silverArtifactId?: string | null
  goldArtifactId?: string | null
}) {
  const store = createStore()
  store.set(dwDraftIdAtom, opts.draftId ?? null)
  store.set(dwDraftArtifactIdAtom, opts.silverArtifactId ?? null)
  store.set(dwDraftGoldArtifactIdAtom, opts.goldArtifactId ?? null)
  const wrapper = ({ children }: { children: ReactNode }) =>
    Provider({ store, children })
  const rendered = renderHook(() => useDatasetValidation(), { wrapper })
  return { ...rendered, store }
}

describe('useDatasetValidation (DS-LAKE-008-T01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is unavailable with no draft/artifact at all — the edit-mode case, since hydration never sets these atoms', () => {
    const { result } = renderWithStore({})

    expect(result.current.status).toBe('unavailable')
    expect(datasetDraftService.validate).not.toHaveBeenCalled()
  })

  it('prefers GOLD over SILVER when both exist', async () => {
    vi.mocked(datasetDraftService.validate).mockResolvedValue({
      data: PASS_REPORT,
    } as never)
    renderWithStore({
      draftId: 'draft-1',
      silverArtifactId: 'silver-1',
      goldArtifactId: 'gold-1',
    })

    await waitFor(() =>
      expect(datasetDraftService.validate).toHaveBeenCalledWith(
        'draft-1',
        'gold-1',
        {},
      ),
    )
  })

  it('falls back to SILVER when GOLD has not warmed yet', async () => {
    vi.mocked(datasetDraftService.validate).mockResolvedValue({
      data: PASS_REPORT,
    } as never)
    renderWithStore({ draftId: 'draft-1', silverArtifactId: 'silver-1' })

    await waitFor(() =>
      expect(datasetDraftService.validate).toHaveBeenCalledWith(
        'draft-1',
        'silver-1',
        {},
      ),
    )
  })

  it('reports pending, then the resolved status', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(datasetDraftService.validate).mockReturnValue(
      new Promise(r => {
        resolve = r
      }) as never,
    )
    const { result } = renderWithStore({
      draftId: 'draft-1',
      silverArtifactId: 'silver-1',
    })

    expect(result.current.status).toBe('pending')

    await act(async () => {
      resolve({ data: FAIL_REPORT })
    })

    await waitFor(() => expect(result.current.status).toBe('FAIL'))
    expect(result.current.report?.failed_checks).toEqual(['missing_values'])
  })

  it('a failed call stays pending, not PASS — fail closed', async () => {
    vi.mocked(datasetDraftService.validate).mockRejectedValue(
      new Error('network down'),
    )
    const { result } = renderWithStore({
      draftId: 'draft-1',
      silverArtifactId: 'silver-1',
    })

    await waitFor(() => expect(result.current.error).toBe('network down'))
    expect(result.current.status).toBe('pending')
  })

  it('revalidate clears a stale report before the new call resolves', async () => {
    vi.mocked(datasetDraftService.validate).mockResolvedValueOnce({
      data: PASS_REPORT,
    } as never)
    const { result } = renderWithStore({
      draftId: 'draft-1',
      silverArtifactId: 'silver-1',
    })
    await waitFor(() => expect(result.current.status).toBe('PASS'))

    let resolve!: (v: unknown) => void
    vi.mocked(datasetDraftService.validate).mockReturnValueOnce(
      new Promise(r => {
        resolve = r
      }) as never,
    )
    act(() => {
      result.current.revalidate()
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.report).toBeNull()

    await act(async () => {
      resolve({ data: FAIL_REPORT })
    })
    await waitFor(() => expect(result.current.status).toBe('FAIL'))
  })
})
