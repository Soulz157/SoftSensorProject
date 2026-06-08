import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DashboardHeader } from '../dashboard-header'

describe('DashboardHeader', () => {
  it('shows "All Systems Healthy" when alarmCount is 0', () => {
    const { getByText } = render(
      <DashboardHeader alarmCount={0} searchQuery="" onSearch={vi.fn()} />,
    )
    expect(getByText(/all systems healthy/i)).not.toBeNull()
  })

  it('shows alarm count when alarmCount > 0', () => {
    const { getByText } = render(
      <DashboardHeader alarmCount={3} searchQuery="" onSearch={vi.fn()} />,
    )
    expect(getByText(/3 active alarm/i)).not.toBeNull()
  })
})
