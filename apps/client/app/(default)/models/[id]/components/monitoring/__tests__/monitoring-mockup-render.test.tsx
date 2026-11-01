import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { AIModel } from '@/types'
import { mockResponse, type MonitoringFixture } from '@/lib/monitoring-mockup'
import { MOCKUP_MODEL } from '@/components/dev/monitoring-mockup-patch'
import fixture from '@/components/dev/monitoring-mockup-data.json'
import { ModelMonitoringTab } from '../model-monitoring-tab'

/**
 * The dev Monitoring mockup, end to end below the network: the REAL tab,
 * services and hooks, with `fetchClient` answered by the same router the
 * dev fetch patch uses. Proves the fixture renders as a populated tab, not
 * an empty state.
 */
vi.mock('@/lib/fetcher', () => ({
  fetchClient: vi.fn(async (path: string) => {
    const data = mockResponse(
      fixture as unknown as MonitoringFixture,
      MOCKUP_MODEL,
      new URL(path, 'http://api.test'),
      Date.now(),
    )
    if (data === undefined) throw new Error(`unmocked ${path}`)
    return { statusCode: 200, message: 'ok', type: 'SUCCESS', data }
  }),
}))

// Recharts draws nothing at jsdom's zero width, so capture what the tab
// hands the Residual chart instead: proof the card is fed, not empty.
vi.mock('../residual-chart', async importOriginal => {
  const actual = await importOriginal<typeof import('../residual-chart')>()
  return {
    ...actual,
    ResidualChart: ({
      rows,
    }: {
      rows: Array<{ residual?: number | null }>
    }) => (
      <div data-testid="residual-chart">
        {rows.filter(r => typeof r.residual === 'number').length}
      </div>
    ),
  }
})

// Same reason for the top chart: capture which series its rows carry.
vi.mock('../actual-vs-predict-chart', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../actual-vs-predict-chart')>()
  return {
    ...actual,
    ActualVsPredictChart: ({
      rows,
    }: {
      rows: Array<Record<string, unknown>>
    }) => {
      const keys = new Set<string>()
      for (const r of rows)
        for (const [k, v] of Object.entries(r))
          if (typeof v === 'number' || Array.isArray(v)) keys.add(k)
      return <div data-testid="avp-chart">{[...keys].sort().join(',')}</div>
    },
  }
})

const MODEL = {
  id: MOCKUP_MODEL.modelId,
  workspaceId: 'ws-1',
  name: 'ModelTest 1',
  data: { deployStatus: 'running', enabled: true, prodStatus: 'normal' },
} as unknown as AIModel

describe('Monitoring mockup — the real tab renders the ModelTest 1 fixture', () => {
  it('fills the tab instead of an empty state', async () => {
    render(<ModelMonitoringTab model={MODEL} />)
    await waitFor(
      () =>
        expect(screen.getAllByText(/S204IBP\.lab/).length).toBeGreaterThan(0),
      { timeout: 4000 },
    )
    expect(
      screen.queryByText(/No completed inference windows/i),
    ).not.toBeInTheDocument()
    await waitFor(
      () => expect(screen.getAllByText(/FI001\.PV/).length).toBeGreaterThan(0),
      { timeout: 4000 },
    )
  })

  it('draws only Actual, Predict and the 1 SD band — no scheduled or held series', async () => {
    render(<ModelMonitoringTab model={MODEL} />)
    const chart = await screen.findByTestId('avp-chart', undefined, {
      timeout: 4000,
    })
    await waitFor(() => expect(chart.textContent).toContain('actual'), {
      timeout: 4000,
    })
    // The chart draws sd1, held, scheduled, predict, manual and actual
    // (sd2/sd3 ride the rows but their Areas are commented out).
    const keys = (chart.textContent ?? '').split(',')
    expect(keys).toEqual(expect.arrayContaining(['actual', 'predict', 'sd1']))
    for (const drawn of ['scheduled', 'held', 'manual', 'live'])
      expect(keys).not.toContain(drawn)
  })

  it('feeds the Residual Analysis card a measured residual every hour', async () => {
    render(<ModelMonitoringTab model={MODEL} />)
    expect(
      screen.getByText(/Residual Analysis \(Actual − Predict\)/),
    ).toBeInTheDocument()
    const chart = await screen.findByTestId('residual-chart', undefined, {
      timeout: 4000,
    })
    // 24 h of hourly lab pairs (the range edges may add or drop one hour).
    await waitFor(
      () => expect(Number(chart.textContent)).toBeGreaterThanOrEqual(23),
      { timeout: 4000 },
    )
  })
})
