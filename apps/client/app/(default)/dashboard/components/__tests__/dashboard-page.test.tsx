import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../../../../hooks/use-dashboard-data', () => ({
  useDashboardData: vi.fn(() => ({
    workspaces: [
      {
        id: 'ws1',
        name: 'Zone A',
        status: 'alarm',
        alarmCount: 1,
        nodeCount: 1,
        color: 'blue',
        icon: 'building',
        createdAt: '',
        updatedAt: '',
        _count: { members: 1, models: 0 },
        modelsCount: 0,
      },
    ],
    nodes: [
      {
        id: 'n1',
        workspaceId: 'ws1',
        data: {
          name: 'CNC-001',
          type: 'machine',
          status: 'alarm',
          x: 100,
          y: 100,
        },
        models: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    loading: false,
    error: null,
  })),
}))

import DashboardPage from '../../page'

describe('DashboardPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<DashboardPage />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the sidebar', () => {
    const { getByText } = render(<DashboardPage />)
    expect(getByText('Zone A')).not.toBeNull()
  })

  it('renders the SVG map', () => {
    const { container } = render(<DashboardPage />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders empty detail panel state', () => {
    const { getByText } = render(<DashboardPage />)
    expect(getByText(/select a device/i)).not.toBeNull()
  })
})
