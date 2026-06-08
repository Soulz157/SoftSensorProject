import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { NodeDetailPanel } from '../node-detail-panel'
import type { CanvasNode } from '@/services/canvas'

const mockNode: CanvasNode = {
  id: 'n1',
  workspaceId: 'ws1',
  data: { name: 'CNC-001', type: 'machine', status: 'alarm', x: 100, y: 100 },
  models: [
    { id: 'm1', name: 'AnomalyDetect v2', data: null, nodesId: 'n1' },
    { id: 'm2', name: 'VibrationFFT', data: null, nodesId: 'n1' },
  ],
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
}

describe('NodeDetailPanel', () => {
  it('shows empty state when no node selected', () => {
    const { getByText } = render(
      <NodeDetailPanel node={null} workspaceId={null} />,
    )
    expect(getByText(/select a device/i)).not.toBeNull()
  })

  it('shows node name when node selected', () => {
    const { getByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getByText('CNC-001')).not.toBeNull()
  })

  it('shows AI model names', () => {
    const { getByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getByText('AnomalyDetect v2')).not.toBeNull()
    expect(getByText('VibrationFFT')).not.toBeNull()
  })

  it('shows alarm status chip for alarm node', () => {
    const { getAllByText } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    expect(getAllByText(/alarm/i).length).toBeGreaterThan(0)
  })

  it('shows "View Details" CTA linking to workspace canvas', () => {
    const { container } = render(
      <NodeDetailPanel node={mockNode} workspaceId="ws1" />,
    )
    const link = container.querySelector('a[href*="ws1/canvas"]')
    expect(link).not.toBeNull()
  })
})
