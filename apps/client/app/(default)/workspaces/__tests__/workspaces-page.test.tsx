import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Workspace } from '@/types'

const getNodesSpy = vi.fn()
const useWorkspacesMock = vi.fn()

vi.mock('@/services/canvas', () => ({
  getNodes: (...args: unknown[]) => getNodesSpy(...args),
}))

vi.mock('@/hooks/workspace/use-workspaces', () => ({
  useWorkspaces: () => useWorkspacesMock(),
}))

vi.mock('@/components/create-workspace', () => ({
  CreateWorkspaceDialog: () => null,
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

import WorkspacesPage from '../page'

const makeWorkspace = (i: number): Workspace => ({
  id: `ws${i}`,
  ownerId: 'u1',
  name: `Workspace ${i}`,
  icon: 'box',
  color: 'blue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  _count: { members: 1, models: 2 },
  modelsCount: 2,
  plantsCount: 3,
  datasetsCount: 4,
  status: 'normal',
})

describe('WorkspacesPage', () => {
  beforeEach(() => {
    getNodesSpy.mockClear()
    useWorkspacesMock.mockReset()
  })

  // -------------------------------------------------------------------------
  // DS-LAKE-029-V02 — the N+1 is gone (client half)
  // -------------------------------------------------------------------------
  it('issues no per-workspace node request, for one workspace or for fifty', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [makeWorkspace(1)],
      loading: false,
    })
    render(<WorkspacesPage />)
    expect(getNodesSpy).not.toHaveBeenCalled()

    useWorkspacesMock.mockReturnValue({
      workspaces: Array.from({ length: 50 }, (_, i) => makeWorkspace(i)),
      loading: false,
    })
    render(<WorkspacesPage />)
    expect(getNodesSpy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // T05 — the skeleton is reachable for the first time
  // -------------------------------------------------------------------------
  it('renders card skeletons while loading, not a full-page spinner', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: [], loading: true })
    const { container } = render(<WorkspacesPage />)

    // The skeleton grid exists — it was unreachable before, sitting below an
    // early return that already caught `workspacesLoading`.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length)
      .toBeGreaterThan(0)
    expect(screen.queryByText(/Loading workspaces/i)).toBeNull()
    expect(screen.queryByText(/No workspaces yet/i)).toBeNull()
  })

  // -------------------------------------------------------------------------
  // T05 — the empty state REPLACES the grid
  // -------------------------------------------------------------------------
  it('shows the empty state instead of an empty grid', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: [], loading: false })
    const { container } = render(<WorkspacesPage />)

    expect(screen.getByText(/No workspaces yet/i)).toBeInTheDocument()
    // No grid container is rendered alongside the message.
    expect(container.querySelectorAll('.lg\\:grid-cols-2')).toHaveLength(0)
  })

  it('renders the grid and no empty state once workspaces exist', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [makeWorkspace(1), makeWorkspace(2)],
      loading: false,
    })
    render(<WorkspacesPage />)

    expect(screen.queryByText(/No workspaces yet/i)).toBeNull()
    expect(screen.getByText('Workspace 1')).toBeInTheDocument()
    expect(screen.getByText('Workspace 2')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Summary KPI follows the same unknown-is-not-zero rule as the cards
  // -------------------------------------------------------------------------
  it('sums the model counts when every workspace supplies one', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { ...makeWorkspace(1), modelsCount: 2 },
        { ...makeWorkspace(2), modelsCount: 5 },
      ],
      loading: false,
    })
    render(<WorkspacesPage />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders the total as an em-dash when any count is unknown, not as 0', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { ...makeWorkspace(1), modelsCount: 2 },
        { ...makeWorkspace(2), modelsCount: undefined },
      ],
      loading: false,
    })
    const { container } = render(<WorkspacesPage />)

    // The old `totalModels || '0'` rendered a hard "0" here, masking a NaN.
    const totalModelsKpi = screen.getByText('Total Models').previousSibling
    expect(totalModelsKpi?.textContent).toBe('—')
    expect(container.textContent).not.toContain('NaN')
  })

  it('reports a genuine zero total as 0', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [{ ...makeWorkspace(1), modelsCount: 0 }],
      loading: false,
    })
    render(<WorkspacesPage />)
    const totalModelsKpi = screen.getByText('Total Models').previousSibling
    expect(totalModelsKpi?.textContent).toBe('0')
  })
})
