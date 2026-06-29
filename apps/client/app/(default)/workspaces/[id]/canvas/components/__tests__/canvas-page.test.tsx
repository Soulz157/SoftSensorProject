import { Suspense, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CanvasData } from '@/hooks/canvas/use-canvas'

const { mockCanvasNode } = vi.hoisted(() => {
  const node: CanvasData['nodes'][number] = {
    id: 'n1',
    type: 'machineNode',
    position: { x: 120, y: 160 },
    data: {
      name: 'CNC-001',
      type: 'machine',
      status: 'alarm',
      icon: undefined,
      models: [],
    },
  }

  return { mockCanvasNode: node }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams('nodeId=n1'),
}))

vi.mock('@xyflow/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ReactFlow: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'react-flow' }, children),
    Background: () =>
      React.createElement('div', { 'data-testid': 'background' }),
    Controls: () => React.createElement('div', { 'data-testid': 'controls' }),
    MiniMap: () => React.createElement('div', { 'data-testid': 'mini-map' }),
    ConnectionMode: { Loose: 'loose' },
    BackgroundVariant: { Dots: 'dots' },
  }
})

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

vi.mock('@/hooks/workspace/use-workspace-by', () => ({
  useWorkspace: () => ({ workspace: { name: 'Acme Refinery' } }),
}))

vi.mock('@/hooks/workspace/use-workspace-plans', () => ({
  useWorkspacePlans: () => ({
    plans: [{ id: 'plant1', name: 'Plant Alpha' }],
  }),
}))

vi.mock('@/hooks/canvas/use-canvas', () => ({
  useCanvas: () => ({
    nodes: [mockCanvasNode],
    edges: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/canvas/use-canas-edit', () => ({
  useCanvasEditor: () => ({
    isBuildMode: false,
    handleToggleMode: vi.fn(),
    nodes: [mockCanvasNode],
    edges: [],
    hasPendingChanges: false,
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onNodeDragStop: vi.fn(),
    onNodesDelete: vi.fn(),
    onEdgesDelete: vi.fn(),
    handleAddNode: vi.fn(),
    handleDeleteSelected: vi.fn(),
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
  }),
}))

vi.mock(
  '@/app/(default)/workspaces/[id]/canvas/components/machine-node',
  () => ({
    MachineNode: () => <div>Machine node</div>,
  }),
)

vi.mock(
  '@/app/(default)/workspaces/[id]/canvas/components/add-node-dialog',
  () => ({
    AddNodeDialog: () => <div>Add node dialog</div>,
  }),
)

vi.mock(
  '@/app/(default)/workspaces/[id]/canvas/components/node-detail-sheet',
  () => ({
    NodeDetailPanel: ({ node }: { node: CanvasData['nodes'][number] }) => (
      <aside>Selected {node.data.name}</aside>
    ),
  }),
)

vi.mock(
  '@/app/(default)/workspaces/[id]/canvas/components/legend-panel',
  () => ({
    LegendPanel: () => <div>Legend</div>,
  }),
)

vi.mock(
  '@/app/(default)/workspaces/[id]/canvas/components/canvas-tool-bar',
  () => ({
    CanvasToolbar: () => <div>Canvas toolbar</div>,
  }),
)

import CanvasPage from '../../page'

describe('CanvasPage', () => {
  it('opens the matching node detail panel from nodeId search param', async () => {
    render(
      <Suspense fallback={<div>Loading route</div>}>
        <CanvasPage params={Promise.resolve({ id: 'ws1' })} />
      </Suspense>,
    )

    expect(await screen.findByText('Selected CNC-001')).toBeInTheDocument()
  })
})
