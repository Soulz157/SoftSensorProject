import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RuntimeEstimate } from '../runtime-estimate'
import type { RuntimeInput } from '@/lib/model/estimate-runtime'

/**
 * MODEL-FLOW-038. The long-run notice: said in words before Start when the
 * estimate is past 15 minutes — a run that long is a decision — and silent
 * otherwise. Plain muted text, not red or amber (those stay with status).
 */
const SMALL: RuntimeInput = {
  rows: 5_000,
  features: 10,
  algorithms: ['ridge'],
  targets: 1,
  findBestParams: false,
}

// A 27-combination extra_trees search on 34,030 rows x 100 features: ~25 min.
const LONG: RuntimeInput = {
  rows: 34_030,
  features: 100,
  algorithms: ['extra_trees'],
  targets: 1,
  findBestParams: true,
  gridFits: 27,
}

function renderEstimate(
  input: RuntimeInput,
  status: 'idle' | 'training' | 'done' | 'error' = 'idle',
) {
  return render(<RuntimeEstimate {...input} status={status} progress={0} />)
}

const notice = () => screen.getByText(/This may take about/).closest('p')!

describe('RuntimeEstimate — long-run notice', () => {
  it('says nothing for a short run', () => {
    renderEstimate(SMALL)
    expect(screen.queryByText(/This may take about/)).toBeNull()
  })

  it('warns before Start when the estimate is past 15 minutes, naming the time and the way to shorten it', () => {
    renderEstimate(LONG)
    expect(notice()).toHaveAttribute('role', 'status')
    expect(notice()).toHaveTextContent(/\d+m/) // a duration in minutes
    expect(notice()).toHaveTextContent('remove values from the grid')
    expect(notice()).toHaveTextContent('You can cancel while it runs')
  })

  it('names the parallel workers when the search runs on more than one', () => {
    renderEstimate({ ...LONG, searchWorkers: 2 })
    expect(notice()).toHaveTextContent('with the search on 2 parallel workers')
  })

  it('does not mention workers for a serial search', () => {
    renderEstimate({ ...LONG, searchWorkers: 1 })
    expect(notice()).not.toHaveTextContent('parallel workers')
  })

  it('reads shorter on two workers than on one — the estimate divides the search', () => {
    const serial = renderEstimate({ ...LONG, searchWorkers: 1 })
    const serialText = notice().textContent
    serial.unmount()
    renderEstimate({ ...LONG, searchWorkers: 2 })
    expect(notice().textContent).not.toEqual(serialText)
  })

  it('uses no red or amber for the notice', () => {
    renderEstimate(LONG)
    expect(notice().className).not.toMatch(/red|amber|destructive/)
  })

  it('is hidden once the run is live: the clock takes over', () => {
    renderEstimate(LONG, 'training')
    expect(screen.queryByText(/This may take about/)).toBeNull()
  })
})
