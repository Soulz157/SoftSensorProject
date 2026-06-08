import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { IsometricMap } from '../isometric-map'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws1',
    ownerId: 'u1',
    name: 'Zone A',
    color: 'blue',
    icon: 'building',
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
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  },
]

const mockNodes: CanvasNode[] = [
  {
    id: 'n1',
    workspaceId: 'ws1',
    data: { name: 'CNC-001', type: 'machine', status: 'alarm', x: 100, y: 100 },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'n2',
    workspaceId: 'ws1',
    data: {
      name: 'SENSOR-01',
      type: 'sensor',
      status: 'normal',
      x: 200,
      y: 200,
    },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'n3',
    workspaceId: 'ws2',
    data: {
      name: 'CTRL-01',
      type: 'controller',
      status: 'normal',
      x: 100,
      y: 100,
    },
    models: [],
    createdAt: '',
    updatedAt: '',
  },
]

describe('IsometricMap', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a zone label for each workspace', () => {
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(getByText('ZONE A')).not.toBeNull()
    expect(getByText('ZONE B')).not.toBeNull()
  })

  it('renders a MachineNode for each node', () => {
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
      />,
    )
    expect(getByText('CNC-001')).not.toBeNull()
    expect(getByText('SENSOR-01')).not.toBeNull()
    expect(getByText('CTRL-01')).not.toBeNull()
  })

  it('calls onNodeClick with nodeId when node is clicked', async () => {
    const onNodeClick = vi.fn()
    const { getByText } = render(
      <IsometricMap
        workspaces={mockWorkspaces}
        nodes={mockNodes}
        selectedWorkspaceId={null}
        selectedNodeId={null}
        onNodeClick={onNodeClick}
      />,
    )
    getByText('CNC-001')
      .closest('g')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNodeClick).toHaveBeenCalledWith('n1')
  })
})
