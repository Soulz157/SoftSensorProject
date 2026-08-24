import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDatasetExport } from '../use-dataset-export'
import { datasetVersionService } from '@/services/dataset-version'

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    startExport: vi.fn(),
    job: vi.fn(),
    exportDownload: vi.fn(),
  },
}))

const openSpy = vi.fn()
vi.stubGlobal('open', openSpy)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDatasetExport', () => {
  it('start() runs the job to completion and lands on ready', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: 'export-1' },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))

    await act(async () => {
      await result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.error).toBeNull()
  })

  it('start() reports error status when the job fails', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: { status: 'FAILED', error: 'boom' },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))

    await act(async () => {
      await result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('boom')
  })

  it('download() fetches a fresh URL and opens it', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: 'export-1' },
    } as never)
    vi.mocked(datasetVersionService.exportDownload).mockResolvedValue({
      data: {
        downloadUrl: 'https://minio.example/signed',
        expiresAt: '2026-08-24T01:00:00Z',
      },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))
    await act(async () => {
      await result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.download()
    })

    expect(datasetVersionService.exportDownload).toHaveBeenCalledWith(
      'ds-1',
      'export-1',
    )
    expect(openSpy).toHaveBeenCalledWith(
      'https://minio.example/signed',
      '_blank',
      'noreferrer',
    )
  })

  it('start() is a no-op when datasetId is null', async () => {
    const { result } = renderHook(() => useDatasetExport(null))

    await act(async () => {
      await result.current.start()
    })

    expect(datasetVersionService.startExport).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('resets to idle when datasetId changes — a stale ready/download state must not leak across datasets', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: { status: 'SUCCEEDED', resultArtifactId: 'export-1' },
    } as never)

    const { result, rerender } = renderHook(
      ({ datasetId }: { datasetId: string | null }) =>
        useDatasetExport(datasetId),
      { initialProps: { datasetId: 'ds-1' } },
    )

    await act(async () => {
      await result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender({ datasetId: 'ds-2' })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()

    // download() must no-op with no artifactId carried over from ds-1.
    await act(async () => {
      await result.current.download()
    })
    expect(datasetVersionService.exportDownload).not.toHaveBeenCalled()
  })
})
