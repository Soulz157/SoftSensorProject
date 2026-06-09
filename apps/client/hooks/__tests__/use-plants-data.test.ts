import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlantsData } from '../use-plants-data'

vi.mock('@/services/canvas', () => ({
  getNodes: vi.fn(),
}))

vi.mock('jotai', () => ({
  useAtomValue: vi.fn(),
}))

vi.mock('@/store/workspace', () => ({
  workspacesAtom: Symbol('workspacesAtom'),
}))

import { getNodes } from '@/services/canvas'
import { useAtomValue } from 'jotai'

const mockWorkspaces = [
  {
    id: 'ws-1',
    name: 'Plant A',
    color: 'blue',
    icon: 'building',
    nodeCount: 5,
    alarmCount: 1,
    status: 'alarm',
  },
  {
    id: 'ws-2',
    name: 'Plant B',
    color: 'emerald',
    icon: 'cpu',
    nodeCount: 3,
    alarmCount: 0,
    status: 'normal',
  },
]

const mockNodes = [
  {
    id: 'n-1',
    workspaceId: 'ws-1',
    planId: 'p-1',
    data: { name: 'CNC #1', type: 'machine', status: 'alarm', x: 0, y: 0 },
    models: [],
    createdAt: '',
    updatedAt: '2026-06-09T10:00:00Z',
  },
  {
    id: 'n-2',
    workspaceId: 'ws-2',
    planId: 'p-2',
    data: { name: 'Sensor #1', type: 'sensor', status: 'normal', x: 0, y: 0 },
    models: [],
    createdAt: '',
    updatedAt: '2026-06-09T10:00:00Z',
  },
]

describe('usePlantsData', () => {
  beforeEach(() => {
    vi.mocked(useAtomValue).mockReturnValue(mockWorkspaces)
    vi.mocked(getNodes)
      .mockResolvedValueOnce([mockNodes[0]])
      .mockResolvedValueOnce([mockNodes[1]])
  })

  it('returns loading=true initially', () => {
    const { result } = renderHook(() => usePlantsData())
    expect(result.current.loading).toBe(true)
  })

  it('returns all workspaces and nodes after fetch', async () => {
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.workspaces).toHaveLength(2)
    expect(result.current.nodesByWorkspace['ws-1']).toHaveLength(1)
    expect(result.current.nodesByWorkspace['ws-2']).toHaveLength(1)
  })

  it('returns empty nodesByWorkspace when no workspaces', async () => {
    vi.mocked(useAtomValue).mockReturnValue([])
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nodesByWorkspace).toEqual({})
  })
})
