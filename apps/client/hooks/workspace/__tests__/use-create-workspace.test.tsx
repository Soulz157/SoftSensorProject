import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toBinaryStatus } from '@/lib/overview-status'

const fetchClientMock = vi.fn()
const setWorkspacesMock = vi.fn()
const bumpRevisionMock = vi.fn()

vi.mock('@/lib/fetcher', () => ({
  fetchClient: (...args: unknown[]) => fetchClientMock(...args),
}))

vi.mock('jotai', async importOriginal => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useSetAtom: (a: unknown) =>
    a === workspacesAtom ? setWorkspacesMock : bumpRevisionMock,
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { workspacesAtom } from '@/store/workspace'
import { useCreateWorkspace } from '../use-create-workspace'

describe('useCreateWorkspace', () => {
  beforeEach(() => {
    fetchClientMock.mockReset()
    setWorkspacesMock.mockReset()
    bumpRevisionMock.mockReset()
  })

  // The admin dashboard reloads on this revision (both create dialogs share
  // this hook). Only a create that SUCCEEDED may bump it.
  it('bumps the workspaces revision once on success', async () => {
    fetchClientMock.mockResolvedValue({
      data: { id: 'ws-new', name: 'Mock', icon: 'box', color: 'blue' },
    })
    const { result } = renderHook(() => useCreateWorkspace())
    let res: { success: boolean } = { success: false }
    await act(async () => {
      res = await result.current.createWorkspace({ name: 'Mock' } as never)
    })
    expect(res.success).toBe(true)
    expect(bumpRevisionMock).toHaveBeenCalledTimes(1)
    const bump = bumpRevisionMock.mock.calls[0]?.[0] as (n: number) => number
    expect(bump(4)).toBe(5)
  })

  it('a failed create bumps nothing and reports failure', async () => {
    fetchClientMock.mockRejectedValue(new Error('name taken'))
    const { result } = renderHook(() => useCreateWorkspace())
    let res: { success: boolean } = { success: true }
    await act(async () => {
      res = await result.current.createWorkspace({ name: 'Mock' } as never)
    })
    expect(res.success).toBe(false)
    expect(bumpRevisionMock).not.toHaveBeenCalled()
    expect(setWorkspacesMock).not.toHaveBeenCalled()
  })

  /**
   * DS-LAKE-029 regression. The create endpoint never runs
   * `deriveNodeSummary`, so its response carries no `status`. This hook
   * appends that object straight into `workspacesAtom` rather than
   * refetching, and `toBinaryStatus(undefined)` evaluates to 'abnormal' —
   * so a workspace the user just created would render a pulsing red alarm
   * on the one surface DESIGN.md:153 reserves red for.
   */
  it('puts a truthful status and zeroed counts on a newly created workspace', async () => {
    fetchClientMock.mockResolvedValue({
      data: {
        id: 'ws-new',
        ownerId: 'u1',
        name: 'Brand New',
        icon: 'box',
        color: 'blue',
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
        _count: { members: 1, models: 0 },
      },
    })

    const { result } = renderHook(() => useCreateWorkspace())
    await act(async () => {
      await result.current.createWorkspace({
        name: 'Brand New',
        icon: 'box',
        color: 'blue',
      } as never)
    })

    expect(setWorkspacesMock).toHaveBeenCalledTimes(1)
    const call = setWorkspacesMock.mock.calls[0]
    if (!call) throw new Error('setWorkspaces was never called')
    const updater = call[0] as (
      prev: unknown[],
    ) => Array<Record<string, unknown>>
    const appended = updater([])
    expect(appended).toHaveLength(1)
    const created = appended[0]
    if (!created) throw new Error('no workspace was appended')

    // The value that prevents the false alarm.
    expect(created.status).toBe('normal')
    expect(toBinaryStatus(created.status as 'normal')).toBe('normal')

    // A brand-new workspace genuinely contains nothing, so 0 is truthful
    // here — this is NOT the unknown-versus-zero conflation the card
    // refuses, because these counts are known.
    expect(created.modelsCount).toBe(0)
    expect(created.plantsCount).toBe(0)
    expect(created.datasetsCount).toBe(0)
  })
})
