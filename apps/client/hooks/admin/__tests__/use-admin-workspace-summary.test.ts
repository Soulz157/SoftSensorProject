import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const getSummary = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))
vi.mock('@/services/workspace', () => ({
  workspaceService: { getAdminWorkspaceSummary: () => getSummary() },
}))

import { useAdminWorkspaceSummary } from '../use-admin-workspace-summary'

const data = { total: 3, models: 9, attentionTotal: 0, attention: [] }

describe('useAdminWorkspaceSummary', () => {
  beforeEach(() => {
    // A block body on purpose: vitest runs a function RETURNED from
    // beforeEach as a cleanup, which would call the mock after the test.
    getSummary.mockReset()
  })

  it('loads the summary', async () => {
    getSummary.mockResolvedValue({ data })
    const { result } = renderHook(() => useAdminWorkspaceSummary())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual(data))
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('reports a failure as an error with NO data (never a healthy summary)', async () => {
    getSummary.mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useAdminWorkspaceSummary())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('drops stale numbers when a refetch fails, and recovers on retry', async () => {
    getSummary.mockResolvedValueOnce({ data })
    const { result } = renderHook(() => useAdminWorkspaceSummary())
    await waitFor(() => expect(result.current.data).toEqual(data))

    getSummary.mockRejectedValueOnce(new Error('x'))
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeNull()

    getSummary.mockResolvedValueOnce({ data: { ...data, total: 4 } })
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data?.total).toBe(4))
    expect(result.current.error).toBeNull()
  })
})
