import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WorkspaceSidebar } from '../workspace-sidebar'
import type { Workspace } from '@/types'

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws1',
    ownerId: 'u1',
    name: 'Zone A',
    color: 'blue',
    icon: 'building',
    alarmCount: 2,
    status: 'alarm',
    nodeCount: 4,
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
  {
    id: 'ws2',
    ownerId: 'u1',
    name: 'Zone B',
    color: 'emerald',
    icon: 'cpu',
    alarmCount: 0,
    status: 'normal',
    nodeCount: 3,
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
]

describe('WorkspaceSidebar', () => {
  it('renders workspace names', () => {
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    expect(getByText('Zone A')).not.toBeNull()
    expect(getByText('Zone B')).not.toBeNull()
  })

  it('calls onSelectWorkspace with workspace id on click', () => {
    const onSelect = vi.fn()
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={onSelect}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    fireEvent.click(getByText('Zone A').closest('[data-ws]')!)
    expect(onSelect).toHaveBeenCalledWith('ws1')
  })

  it('highlights selected workspace', () => {
    const { container } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId="ws1"
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={vi.fn()}
      />,
    )
    const items = container.querySelectorAll('[data-ws]')
    expect(items[0].className).toContain('border-primary')
  })

  it('calls onStatusFilter when alarm filter clicked', () => {
    const onFilter = vi.fn()
    const { getByText } = render(
      <WorkspaceSidebar
        workspaces={mockWorkspaces}
        selectedWorkspaceId={null}
        onSelectWorkspace={vi.fn()}
        statusFilter={null}
        onStatusFilter={onFilter}
      />,
    )
    fireEvent.click(getByText(/Alarm/))
    expect(onFilter).toHaveBeenCalledWith('alarm')
  })
})
