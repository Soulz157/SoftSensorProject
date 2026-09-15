import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { NodeDetailPanel } from '../node-detail-panel'
import type { CanvasNode } from '@/services/canvas'
import type { WorkspacePlant } from '@/types'

const mockNode: CanvasNode = {
  id: 'n1',
  workspaceId: 'ws1',
  planId: 'plant1',
  data: { name: 'CNC-001', type: 'machine', status: 'alarm', x: 100, y: 100 },
  models: [
    { id: 'm1', name: 'AnomalyDetect v2', data: null, nodesId: 'n1' },
    { id: 'm2', name: 'VibrationFFT', data: null, nodesId: 'n1' },
  ],
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
}

const mockPlant: WorkspacePlant = {
  id: 'plant1',
  workspaceId: 'ws1',
  name: 'Plant Alpha',
  status: 'warning',
  nodeCount: 4,
  alarmCount: 1,
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
}

describe('NodeDetailPanel', () => {
  it('renders nothing when no node and no plan selected', () => {
    const { container } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={null}
        plan={mockPlant}
        workspaceId={null}
        onClose={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows plant details in plant mode', () => {
    const { getByText } = render(
      <NodeDetailPanel
        viewMode="plants"
        node={null}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )
    expect(getByText('Plant Alpha')).not.toBeNull()
    expect(getByText(/view equipment/i)).not.toBeNull()
  })

  it('shows node name when node selected', () => {
    const { getByText } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={mockNode}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )
    expect(getByText('CNC-001')).not.toBeNull()
  })

  it('shows AI model names', () => {
    const { getByText } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={mockNode}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )
    expect(getByText('AnomalyDetect v2')).not.toBeNull()
    expect(getByText('VibrationFFT')).not.toBeNull()
  })

  it('shows alarm status chip for alarm node', () => {
    const { getAllByText } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={mockNode}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )
    expect(getAllByText(/alarm/i).length).toBeGreaterThan(0)
  })

  // MODEL-SERVE-001-T22. DEPLOY_DOT/DEPLOY_LABEL were keyed `failed` while
  // the wire sends `error`, so a failing model missed both lookups and took
  // the green `?? 'bg-emerald-500'` / `?? 'text-emerald-500'` fallbacks —
  // the word "error" rendered in the healthy colour. A silent fall-through,
  // so the assertion has to be on the painted class, not the map.
  it('paints a failing model red, never the green no-status fallback', () => {
    const failingNode: CanvasNode = {
      ...mockNode,
      models: [
        {
          id: 'm1',
          name: 'AnomalyDetect v2',
          data: { deployStatus: 'error' },
          nodesId: 'n1',
        },
      ],
    } as unknown as CanvasNode

    const { getByText, container } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={failingNode}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )

    const label = getByText('error')
    expect(label.className).toContain('text-red-500')
    expect(label.className).not.toContain('text-emerald-500')
    expect(container.querySelector('.bg-red-500')).not.toBeNull()
  })

  it('shows "Open Node Canvas" CTA linking to workspace canvas with nodeId', () => {
    const { container } = render(
      <NodeDetailPanel
        viewMode="equipment"
        node={mockNode}
        plan={mockPlant}
        workspaceId="ws1"
        onClose={() => {}}
      />,
    )
    const link = container.querySelector(
      'a[href="/workspaces/ws1/canvas?nodeId=n1"]',
    )
    expect(link).not.toBeNull()
  })
})
