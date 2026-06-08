import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDashboardData } from '../../../../../hooks/use-dashboard-data'

vi.mock('@/services/canvas', () => ({
  getNodes: vi.fn(),
}))

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai')
  return {
    ...actual,
    useAtomValue: vi.fn(() => [
      {
        id: 'ws1',
        name: 'Zone A',
        status: 'alarm',
        alarmCount: 1,
        nodeCount: 2,
      },
      {
        id: 'ws2',
        name: 'Zone B',
        status: 'normal',
        alarmCount: 0,
        nodeCount: 1,
      },
    ]),
  }
})

import { getNodes } from '@/services/canvas'

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.mocked(getNodes).mockResolvedValue([])
  })

  it('calls getNodes for each workspace', async () => {
    renderHook(() => useDashboardData())
    await waitFor(() => {
      expect(getNodes).toHaveBeenCalledWith('ws1')
      expect(getNodes).toHaveBeenCalledWith('ws2')
    })
  })

  it('returns workspaces from atom', async () => {
    const { result } = renderHook(() => useDashboardData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.workspaces).toHaveLength(2)
  })

  it('returns combined nodes from all workspaces', async () => {
    vi.mocked(getNodes).mockImplementation(async wsId => {
      if (wsId === 'ws1')
        return [
          {
            id: 'n1',
            workspaceId: 'ws1',
            data: {
              name: 'CNC-001',
              type: 'machine' as const,
              status: 'alarm' as const,
              x: 0,
              y: 0,
            },
            models: [],
            createdAt: '',
            updatedAt: '',
          },
        ]
      return []
    })
    const { result } = renderHook(() => useDashboardData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.nodes[0].id).toBe('n1')
  })
})
