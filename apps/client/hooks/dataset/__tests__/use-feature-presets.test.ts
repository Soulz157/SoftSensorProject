import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useFeaturePresets } from '../use-feature-presets'
import { featurePresetService } from '@/services/feature-preset'

vi.mock('@/services/feature-preset', () => ({
  featurePresetService: {
    list: vi.fn(),
    listImports: vi.fn(),
    importWorkbook: vi.fn(),
    getDocument: vi.fn(),
    getSdtaDocument: vi.fn(),
  },
}))

const svc = vi.mocked(featurePresetService)

const latest = { id: 'imp-2', fileName: 'new.xlsx' }
const older = { id: 'imp-1', fileName: 'mine.xlsx' }
const presetsOf = (importId: string) => [
  { id: `${importId}-p1`, unit: 'S-204' },
]
/** The CALLER's uploads: their newest is imp-1, while the workspace's
 * newest overall (imp-2, the default `list`) is a teammate's. */
const UPLOADS = [{ id: 'imp-1', isLatest: true }]

describe('useFeaturePresets — upload history (Feature Preset Manager)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    svc.list.mockImplementation(async (_ws, importId) => {
      const imp = importId === 'imp-1' ? older : latest
      return { data: { import: imp, presets: presetsOf(imp.id) } } as never
    })
    svc.listImports.mockResolvedValue({ data: UPLOADS } as never)
  })

  it("opens on the user's OWN latest upload, not the workspace's", async () => {
    const { result } = renderHook(() => useFeaturePresets('ws-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(svc.listImports).toHaveBeenCalledWith('ws-1')
    expect(svc.list).toHaveBeenCalledWith('ws-1', 'imp-1')
    expect(result.current.currentImport?.id).toBe('imp-1')
    expect(result.current.uploads).toEqual(UPLOADS)
  })

  it('a user with no uploads falls back to the workspace latest', async () => {
    svc.listImports.mockResolvedValue({ data: [] } as never)
    const { result } = renderHook(() => useFeaturePresets('ws-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(svc.list).toHaveBeenCalledWith('ws-1', undefined)
    expect(result.current.currentImport?.id).toBe('imp-2')
  })

  it('selectImport switches the picker to that upload by id', async () => {
    const { result } = renderHook(() => useFeaturePresets('ws-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let next: unknown
    await act(async () => {
      next = await result.current.selectImport('imp-1')
    })

    expect(svc.list).toHaveBeenLastCalledWith('ws-1', 'imp-1')
    expect(next).toEqual(presetsOf('imp-1'))
    expect(result.current.currentImport?.id).toBe('imp-1')
    expect(result.current.presets).toEqual(presetsOf('imp-1'))
  })

  it('a failed switch is surfaced and rethrown', async () => {
    const { result } = renderHook(() => useFeaturePresets('ws-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    svc.list.mockRejectedValueOnce(new Error('gone'))

    await act(async () => {
      await expect(result.current.selectImport('imp-1')).rejects.toThrow('gone')
    })
    expect(result.current.error).toBe('gone')
  })

  it("a failed read of the user's uploads never blocks the picker (workspace latest)", async () => {
    svc.listImports.mockRejectedValue(new Error('history down'))
    const { result } = renderHook(() => useFeaturePresets('ws-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.presets).toEqual(presetsOf('imp-2'))
    expect(result.current.uploads).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('an upload refreshes the history so the new workbook appears as Latest', async () => {
    svc.importWorkbook.mockResolvedValue({ data: {} } as never)
    const { result } = renderHook(() => useFeaturePresets('ws-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const callsBefore = svc.listImports.mock.calls.length

    await act(async () => {
      await result.current.importWorkbook(new File(['x'], 'new.xlsx'))
    })

    await waitFor(() =>
      expect(svc.listImports.mock.calls.length).toBe(callsBefore + 1),
    )
  })
})
