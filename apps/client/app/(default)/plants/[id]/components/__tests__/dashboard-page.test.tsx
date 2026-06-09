import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace, WorkspacePlan } from '@/types'

const { mockWorkspace, mockPlant, mockNodes } = vi.hoisted(() => {
  const workspace: Workspace = {
    id: 'ws1',
    ownerId: 'u1',
    name: 'Acme Refinery',
    status: 'alarm',
    alarmCount: 1,
    nodeCount: 2,
    color: 'blue',
    icon: 'building',
    createdAt: '',
    updatedAt: '',
    _count: { members: 1, models: 0 },
    modelsCount: 0,
  }

  const plant: WorkspacePlan = {
    id: 'plant1',
    workspaceId: 'ws1',
    name: 'Plant Alpha',
    status: 'alarm',
    alarmCount: 1,
    nodeCount: 2,
    color: 'cyan',
    icon: 'building',
    description: 'Primary production plant',
    createdAt: '',
    updatedAt: '',
  }

  const nodes: CanvasNode[] = [
    {
      id: 'n1',
      workspaceId: 'ws1',
      planId: 'plant1',
      data: {
        name: 'CNC-001',
        type: 'machine',
        status: 'alarm',
        x: 100,
        y: 100,
      },
      models: [
        { id: 'm1', name: 'AnomalyDetect v2', data: null, nodesId: 'n1' },
      ],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T01:00:00Z',
    },
    {
      id: 'n2',
      workspaceId: 'ws1',
      planId: 'plant1',
      data: {
        name: 'SENSOR-01',
        type: 'sensor',
        status: 'normal',
        x: 200,
        y: 200,
      },
      models: [],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T01:00:00Z',
    },
  ]

  return { mockWorkspace: workspace, mockPlant: plant, mockNodes: nodes }
})

vi.mock('../../../../../hooks/use-dashboard-data', () => ({
  useDashboardData: vi.fn(() => ({
    workspaces: [mockWorkspace],
    nodes: mockNodes,
    loading: false,
    error: null,
  })),
}))

vi.mock('../../../../../hooks/workspace/use-workspace-plans', () => ({
  useWorkspacePlans: vi.fn(() => ({
    plans: [mockPlant],
    createPlan: vi.fn(),
  })),
}))

import DashboardPage from '../../page'

describe('DashboardPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<DashboardPage />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders breadcrumbs with workspace context', () => {
    render(<DashboardPage />)
    expect(screen.getByText('Acme Refinery')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Plant')).toBeInTheDocument()
    expect(screen.getByText('Equipment')).toBeInTheDocument()
  })

  it('opens the create plant dialog from the top bar', async () => {
    const user = userEvent.setup()
    render(<DashboardPage />)

    await user.click(screen.getByRole('button', { name: /create plant/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/create a new plant/i)).toBeInTheDocument()
  })

  it('switches to grid view and keeps equipment selectable', async () => {
    const user = userEvent.setup()
    render(<DashboardPage />)

    await user.click(screen.getByRole('button', { name: /^grid$/i }))
    expect(screen.getByRole('button', { name: /cnc-001/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cnc-001/i }))
    expect(screen.getByText('Open Node Canvas')).toBeInTheDocument()
  })

  it('renders the SVG map', () => {
    const { container } = render(<DashboardPage />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders empty detail panel state', () => {
    render(<DashboardPage />)
    expect(screen.getByText(/select a plant or equipment/i)).toBeInTheDocument()
  })
})
