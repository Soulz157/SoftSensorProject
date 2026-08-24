import { describe, it, expect, vi } from 'vitest'
import {
  pollJobUntilTerminal,
  pollDraftJobUntilTerminal,
  pollDatasetJobUntilTerminal,
} from './poll-preprocessing-job'
import { datasetDraftService } from '@/services/dataset-draft'
import { datasetVersionService } from '@/services/dataset-version'

vi.mock('@/services/dataset-draft', () => ({
  datasetDraftService: { job: vi.fn() },
}))
vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: { job: vi.fn() },
}))

describe('pollJobUntilTerminal', () => {
  it('polls until a terminal status, returning the terminal row', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: 'RUNNING' } })
      .mockResolvedValueOnce({ data: { status: 'RUNNING' } })
      .mockResolvedValueOnce({ data: { status: 'SUCCEEDED', foo: 'bar' } })

    const result = await pollJobUntilTerminal(fetchJob, () => false)

    expect(result).toEqual({ status: 'SUCCEEDED', foo: 'bar' })
    expect(fetchJob).toHaveBeenCalledTimes(3)
  })

  it('returns null when cancelled before a terminal status arrives', async () => {
    const fetchJob = vi.fn().mockResolvedValue({ data: { status: 'RUNNING' } })
    let cancelled = false

    const promise = pollJobUntilTerminal(fetchJob, () => cancelled)
    cancelled = true

    const result = await promise
    expect(result).toBeNull()
  })

  it.each(['SUCCEEDED', 'FAILED', 'CANCELED'] as const)(
    'treats %s as terminal',
    async status => {
      const fetchJob = vi.fn().mockResolvedValueOnce({ data: { status } })
      const result = await pollJobUntilTerminal(fetchJob, () => false)
      expect(result).toEqual({ status })
    },
  )
})

describe('pollDraftJobUntilTerminal', () => {
  it('polls datasetDraftService.job with the draft/job ids — unchanged signature', async () => {
    const job = vi.mocked(datasetDraftService.job)
    job.mockResolvedValueOnce({
      data: { status: 'SUCCEEDED', resultArtifactId: 'a-1' },
    } as never)

    const result = await pollDraftJobUntilTerminal(
      'draft-1',
      'job-1',
      () => false,
    )

    expect(result).toEqual({ status: 'SUCCEEDED', resultArtifactId: 'a-1' })
    expect(job).toHaveBeenCalledWith('draft-1', 'job-1')
  })
})

describe('pollDatasetJobUntilTerminal', () => {
  it('polls datasetVersionService.job until a terminal status', async () => {
    const job = vi.mocked(datasetVersionService.job)
    job
      .mockResolvedValueOnce({ data: { status: 'RUNNING' } } as never)
      .mockResolvedValueOnce({
        data: { status: 'SUCCEEDED', resultArtifactId: 'a-1' },
      } as never)

    const result = await pollDatasetJobUntilTerminal(
      'ds-1',
      'job-1',
      () => false,
    )

    expect(result).toEqual({ status: 'SUCCEEDED', resultArtifactId: 'a-1' })
    expect(job).toHaveBeenCalledWith('ds-1', 'job-1')
  })

  it('returns null when cancelled before a terminal status arrives', async () => {
    const job = vi.mocked(datasetVersionService.job)
    job.mockResolvedValue({ data: { status: 'RUNNING' } } as never)
    let cancelled = false

    const promise = pollDatasetJobUntilTerminal(
      'ds-1',
      'job-1',
      () => cancelled,
    )
    cancelled = true

    const result = await promise
    expect(result).toBeNull()
  })
})
