import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * MODEL-SERVE-017. The retrain handoff screen, after two rounds of live
 * feedback stripped it back to the one decision it owns.
 *
 * It used to fetch the window as a "preview" and throw the rows away, so the
 * wizard fetched the same window again ("stuck in fetch data again"). Seeding
 * the wizard with those rows would have been worse — the wizard's own fetch
 * is what fires `useDatasetBronzeWarm`'s materialize, which creates the draft
 * and BRONZE artifact everything downstream reads.
 *
 * It then still collected From/To, which Step 2 collects too — the same dates
 * entered twice. The pickers now live only in Step 2.
 *
 * Two rules survive here, and both are pinned below: this screen issues NO
 * data-source request, and it passes the split boundary through so Step 2 can
 * clamp to it. Losing the second would let an operator build and save an
 * entire dataset before the retrain told them the window was never allowed.
 */

const h = vi.hoisted(() => ({
  fetchData: vi.fn(),
  handoff: vi.fn(),
}))

vi.mock('@/services/data-sources', () => ({
  dataSourceService: { fetchData: h.fetchData },
}))

vi.mock('@/hooks/use-data-sources', () => ({
  useDataSources: () => ({
    sources: [{ id: 'src-1', name: 'PI' }],
    loading: false,
  }),
}))

vi.mock('@/hooks/dataset/use-retrain-dataset-handoff', () => ({
  useRetrainDatasetHandoff: () => h.handoff,
}))

vi.mock('@/hooks/model/use-retrain-fetch-dataset', () => ({
  useRetrainBaseDataset: () => ({
    baseDataset: { id: 'ds-base', name: 'Reactor tags', sourceIds: ['src-1'] },
    baseTags: ['TI-101', 'PT-201'],
    loadingBase: false,
  }),
}))

import { RetrainFetchNewData } from '../retrain-fetch-new-data'

const CUT = '2026-01-16 00:00:00'
const BUILD = /Build this dataset in Data Studio/i

beforeEach(() => {
  vi.clearAllMocks()
})

function renderScreen() {
  return render(
    <RetrainFetchNewData
      baseDatasetId="ds-base"
      cutTimestamp={CUT}
      modelId="model-1"
      strategy="NEW_DATA_ONLY"
    />,
  )
}

describe('RetrainFetchNewData', () => {
  it('reads no data itself — the wizard owns the one fetch', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('button', { name: BUILD }))

    // A fetch here is work the wizard must simply redo, and it would skip the
    // materialize the wizard's own fetch performs.
    expect(h.fetchData).not.toHaveBeenCalled()
    expect(h.handoff).toHaveBeenCalledTimes(1)
  })

  it('asks for no dates — they are picked once, in the wizard', () => {
    renderScreen()
    // The whole point of the change: no second date entry on this screen.
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument()
  })

  it('passes the split boundary through so Step 2 can clamp to it', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('button', { name: BUILD }))

    const [, , cutTimestamp, returning] = h.handoff.mock.calls[0]!
    expect(cutTimestamp).toBe(CUT)
    expect(returning).toEqual({ modelId: 'model-1', strategy: 'NEW_DATA_ONLY' })
  })

  it('states the boundary before the operator leaves for the wizard', () => {
    renderScreen()
    // Shown here rather than only in Step 2: it is the constraint that
    // decides whether this whole trip is worth taking.
    expect(screen.getByText(new RegExp(CUT))).toBeInTheDocument()
  })
})
