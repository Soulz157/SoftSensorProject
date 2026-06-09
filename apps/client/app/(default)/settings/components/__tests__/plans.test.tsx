import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlansPage from '../plans'

vi.mock('@/services/plan', () => ({
  planService: {
    listPlans: vi.fn(),
    mySubscription: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const mockPlans = [
  { id: '1', name: 'FREE', price: 0, maxWorkspaces: 1, durationMonths: 1 },
  { id: '2', name: 'STANDARD', price: 8, maxWorkspaces: 3, durationMonths: 1 },
  { id: '3', name: 'PRO', price: 19, maxWorkspaces: 10, durationMonths: 1 },
  {
    id: '4',
    name: 'ENTERPRISE',
    price: null,
    maxWorkspaces: 999,
    durationMonths: 1,
  },
]

describe('PlansPage', () => {
  beforeEach(async () => {
    const { planService } = await import('@/services/plan')
    vi.mocked(planService.listPlans).mockResolvedValue({
      data: mockPlans,
    } as never)
    vi.mocked(planService.mySubscription).mockResolvedValue({
      data: null,
    } as never)
  })

  it('renders all four plan names', async () => {
    render(<PlansPage />)
    expect(await screen.findAllByText('FREE')).toBeTruthy()
    expect(await screen.findAllByText('STANDARD')).toBeTruthy()
    expect(await screen.findAllByText('PRO')).toBeTruthy()
    expect(await screen.findAllByText('ENTERPRISE')).toBeTruthy()
  })

  it('renders STANDARD price as $8', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('$8')).toBeTruthy()
  })

  it('renders PRO price as $19', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('$19')).toBeTruthy()
  })
})
