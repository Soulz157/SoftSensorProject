import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWorkspaceModelLimit } from '../use-workspace-model-limit'
import { useMyWorkspaceQuota } from '../use-my-workspace-quota'

const getWorkspaceById = vi.fn()
const getMyWorkspaceQuota = vi.fn()

vi.mock('@/services/workspace', () => ({
  workspaceService: {
    getWorkspaceById: (id: string) => getWorkspaceById(id) as unknown,
    getMyWorkspaceQuota: () => getMyWorkspaceQuota() as unknown,
  },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const item = (
  current: number,
  limit: number | null,
  source: 'admin' | 'plan' | 'none',
) => ({
  current,
  limit,
  full: limit !== null && current >= limit,
  over: limit !== null && current > limit,
  source,
})

const detail = (id: string, models: ReturnType<typeof item>) => ({
  data: { id, name: id, quota: { models, members: item(1, 3, 'plan') } },
})

beforeEach(() => {
  getWorkspaceById.mockReset()
  getMyWorkspaceQuota.mockReset()
})

describe('useWorkspaceModelLimit (MODEL-SERVE-041)', () => {
  it('explains a full workspace, naming the plan as the source', async () => {
    getWorkspaceById.mockResolvedValue(detail('ws-1', item(5, 5, 'plan')))
    const { result } = renderHook(() => useWorkspaceModelLimit('ws-1'))
    await waitFor(() =>
      expect(result.current).toBe(
        'Model limit reached (5). The owner can upgrade, or an admin can raise it.',
      ),
    )
  })

  it('says an admin can raise an admin-set cap', async () => {
    getWorkspaceById.mockResolvedValue(detail('ws-1', item(2, 2, 'admin')))
    const { result } = renderHook(() => useWorkspaceModelLimit('ws-1'))
    await waitFor(() =>
      expect(result.current).toBe(
        'Model limit reached (2). An admin can raise it.',
      ),
    )
  })

  it('is null while there is room, with no cap, and while loading', async () => {
    getWorkspaceById.mockResolvedValue(detail('ws-1', item(4, 5, 'plan')))
    const room = renderHook(() => useWorkspaceModelLimit('ws-1'))
    expect(room.result.current).toBeNull()
    await waitFor(() => expect(getWorkspaceById).toHaveBeenCalled())
    expect(room.result.current).toBeNull()

    getWorkspaceById.mockResolvedValue(detail('ws-2', item(99, null, 'none')))
    const none = renderHook(() => useWorkspaceModelLimit('ws-2'))
    await waitFor(() => expect(getWorkspaceById).toHaveBeenCalledWith('ws-2'))
    expect(none.result.current).toBeNull()
  })

  it('does not even fetch when disabled (editing a saved model) or with no workspace', () => {
    renderHook(() => useWorkspaceModelLimit('ws-1', false))
    renderHook(() => useWorkspaceModelLimit('', true))
    expect(getWorkspaceById).not.toHaveBeenCalled()
  })
})

describe('useMyWorkspaceQuota (MODEL-SERVE-041)', () => {
  it('gives the note once the plan allowance is used', async () => {
    getMyWorkspaceQuota.mockResolvedValue({
      data: { workspaces: item(1, 1, 'plan') },
    })
    const { result } = renderHook(() => useMyWorkspaceQuota())
    expect(result.current.note).toBeNull()
    await waitFor(() =>
      expect(result.current.note).toBe(
        'You have reached your workspace limit (1) on your current plan. Upgrade your plan to create more.',
      ),
    )
  })

  it('never blocks when the read fails, or when not enabled', async () => {
    getMyWorkspaceQuota.mockRejectedValue(new Error('boom'))
    const failed = renderHook(() => useMyWorkspaceQuota())
    await waitFor(() => expect(failed.result.current.loading).toBe(false))
    expect(failed.result.current.note).toBeNull()

    getMyWorkspaceQuota.mockClear()
    renderHook(() => useMyWorkspaceQuota(false))
    expect(getMyWorkspaceQuota).not.toHaveBeenCalled()
  })
})
