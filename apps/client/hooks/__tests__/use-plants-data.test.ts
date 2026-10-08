import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlantsData } from '../plants/use-plants-data'
import type { CanvasNode } from '@/services/canvas'

vi.mock('@/services/canvas', () => ({
  getNodes: vi.fn(),
}))

vi.mock('jotai', () => ({
  useAtomValue: vi.fn(),
}))

// `usePlantsData` reads TWO atoms — it waits on `workspacesLoadingAtom`
// before treating an empty workspace list as "none" — so the mock has to
// carry both or the hook throws on the missing export.
//
// `vi.hoisted` because `vi.mock`'s factory is hoisted above these
// declarations; a plain `const` would be in its TDZ when the factory runs.
const atoms = vi.hoisted(() => ({
  workspacesAtom: Symbol('workspacesAtom'),
  workspacesLoadingAtom: Symbol('workspacesLoadingAtom'),
}))

vi.mock('@/store/workspace', () => atoms)

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

const mockNodes: CanvasNode[] = [
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

/** Answers PER ATOM: one blanket return value would hand the workspace
 *  array back for `workspacesLoadingAtom` too, and a non-empty array is
 *  truthy — the hook would read "still loading" forever and never fetch. */
function stubAtoms(workspaces: unknown, loading = false) {
  vi.mocked(useAtomValue).mockImplementation((atom: unknown) =>
    atom === atoms.workspacesLoadingAtom ? loading : workspaces,
  )
}

describe('usePlantsData', () => {
  beforeEach(() => {
    stubAtoms(mockWorkspaces)
  })

  it('returns loading=true initially', () => {
    vi.mocked(getNodes).mockResolvedValue([])
    const { result } = renderHook(() => usePlantsData())
    expect(result.current.loading).toBe(true)
  })

  it('returns all workspaces and nodes after fetch', async () => {
    vi.mocked(getNodes)
      .mockResolvedValueOnce([mockNodes[0]!])
      .mockResolvedValueOnce([mockNodes[1]!])
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.workspaces).toHaveLength(2)
    expect(result.current.nodesByWorkspace['ws-1']).toHaveLength(1)
    expect(result.current.nodesByWorkspace['ws-2']).toHaveLength(1)
  })

  it('returns empty nodesByWorkspace when no workspaces', async () => {
    stubAtoms([])
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nodesByWorkspace).toEqual({})
  })

  it('sets error when fetch fails', async () => {
    vi.mocked(getNodes).mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to load equipment data')
  })
})
