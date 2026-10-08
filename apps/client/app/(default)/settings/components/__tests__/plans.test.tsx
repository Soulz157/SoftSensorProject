import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlansPage from '../plans'
import { STATIC_PLANS } from '@/constants/plans'

vi.mock('@/services/plan', () => ({
  planService: {
    listPlans: vi.fn(),
    mySubscription: vi.fn(),
    downgrade: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('PlansPage', () => {
  beforeEach(async () => {
    const { planService } = await import('@/services/plan')
    // Still stubbed so an accidental call cannot hit the network, but the
    // page no longer reads its plan list from here.
    vi.mocked(planService.listPlans).mockResolvedValue({
      data: STATIC_PLANS,
    } as never)
    vi.mocked(planService.mySubscription).mockResolvedValue({
      data: null,
    } as never)
  })

  it('renders all four plan names', async () => {
    render(<PlansPage />)
    expect((await screen.findAllByText('FREE')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('STANDARD')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('PRO')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('ENTERPRISE')).length).toBeGreaterThan(0)
  })

  // PRICES COME FROM `STATIC_PLANS`, not from `listPlans`: `usePlans` reads
  // the constant and calls the API only for the current SUBSCRIPTION. These
  // cases asserted the mocked API's $8/$19 — figures nothing has rendered
  // since the price list moved into the constant. Read from the same
  // constant the component does, so a price change cannot leave this test
  // asserting a number no screen shows.
  it('renders the STANDARD price from the plan constants', async () => {
    render(<PlansPage />)
    const standard = STATIC_PLANS.find(p => p.name === 'STANDARD')!
    expect(await screen.findByText(`$${standard.price}`)).toBeTruthy()
  })

  it('renders the PRO price from the plan constants', async () => {
    render(<PlansPage />)
    const pro = STATIC_PLANS.find(p => p.name === 'PRO')!
    expect(await screen.findByText(`$${pro.price}`)).toBeTruthy()
  })

  it('renders ENTERPRISE as Custom rather than a price', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('Custom')).toBeTruthy()
  })
})
