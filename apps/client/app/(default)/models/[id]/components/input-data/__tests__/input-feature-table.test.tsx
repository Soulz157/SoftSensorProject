import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { InputFeatureRow } from '@/lib/model-input-features'
import { InputFeatureTable } from '../input-feature-table'

/**
 * MODEL-SERVE-001-T12. The table's own honesty check: the header names what
 * the column actually is (drift, not per-tag quality), a logged value never
 * goes through a scaler it was never subject to, and a derived feature's
 * equation renders under its name while a base tag shows nothing extra.
 */

function row(over: Partial<InputFeatureRow> = {}): InputFeatureRow {
  return {
    column: 'FI001.PV',
    driftStatus: 'UNKNOWN',
    driftReason: undefined,
    z: null,
    outOfRangePct: null,
    piStatus: 'UNKNOWN',
    piReason: undefined,
    failingSources: undefined,
    lastValueRaw: null,
    lastSeen: null,
    equation: null,
    ...over,
  }
}

describe('InputFeatureTable (MODEL-SERVE-001-T12)', () => {
  it('names the drift column Drift, and keeps Status for the real quality reading', () => {
    render(<InputFeatureTable rows={[row()]} />)

    // T12 renamed this header away from "Status" because a drift verdict is
    // not a data-quality reading, and the old name let a reader mistake one
    // for the other. T15 then gave "Status" back its honest meaning: PI's
    // own Good/Bad flag. Both headers now exist, each saying what it is.
    expect(
      screen.getByRole('columnheader', { name: 'Drift' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Status' }),
    ).toBeInTheDocument()
  })

  it('MODEL-SERVE-001-T15: renders PI Good/Bad status distinctly from the Drift verdict', () => {
    render(
      <InputFeatureTable
        rows={[
          row({ column: 'GOOD.PV', driftStatus: 'OK', piStatus: 'Good' }),
          row({ column: 'BAD.PV', driftStatus: 'OK', piStatus: 'Bad' }),
        ]}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    // Two different questions, two different answers on the same row: a tag
    // can be Bad in PI while its distribution has not drifted at all.
    expect(screen.getByText('Good')).toBeVisible()
    expect(screen.getByText('Bad')).toBeVisible()
    expect(screen.getAllByText('OK')).toHaveLength(2)
  })

  it('MODEL-SERVE-001-V14: a Bad row never renders its value as 0.0', () => {
    render(
      <InputFeatureTable
        rows={[
          // A valve position legitimately reads near zero, so the number
          // alone cannot distinguish a hole from a measurement — which is
          // why a Bad row must never show a fabricated 0.0. On this tab it
          // structurally cannot: the value column is the /predict request's
          // own logged reading, and the 0.0 MISSING_VALUE substitution only
          // ever happens inside a pipeline frame this tab does not read.
          row({ column: 'VALVE.PV', piStatus: 'Bad', lastValueRaw: 0.02 }),
          row({ column: 'DEAD.PV', piStatus: 'Bad', lastValueRaw: null }),
        ]}
      />,
    )

    expect(screen.getByText('0.02')).toBeVisible()
    // The never-logged one shows an em-dash, not a zero standing in for one.
    expect(screen.getByText('—')).toBeVisible()
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('MODEL-SERVE-001-T15: names the failing source tag on a Bad derived feature', () => {
    render(
      <InputFeatureTable
        rows={[
          row({
            column: 'Spgr_in_feed',
            piStatus: 'Bad',
            failingSources: ['FI003.PV'],
            equation: '(AI001A2.PV*FI001.PV)/(FI003.PV+FI001.PV)',
          }),
        ]}
      />,
    )

    // "Bad" alone is not actionable at six source tags — the row must say
    // WHICH one failed.
    expect(screen.getByText(/via FI003\.PV/)).toBeVisible()
  })

  it('MODEL-SERVE-001-T15: carries no PSI column — that metric lives on the Monitoring tab', () => {
    render(<InputFeatureTable rows={[row({ driftStatus: 'OK' })]} />)

    // PSI was published here briefly (T13) and deliberately removed: this
    // tab answers "is this tag's data healthy", not "has the distribution
    // shifted". The Monitoring tab's Distribution Drift panel keeps both
    // the z-score and PSI side by side.
    expect(
      screen.queryByRole('columnheader', { name: 'PSI' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Drift' })).toBeVisible()
  })

  it('renders a logged value untouched — no inversion, no "(scaled)" suffix', () => {
    render(<InputFeatureTable rows={[row({ lastValueRaw: 190.42 })]} />)

    expect(screen.getByText('190.42')).toBeInTheDocument()
    expect(screen.queryByText(/scaled/i)).not.toBeInTheDocument()
  })

  it('renders an em-dash when the column was never logged', () => {
    render(<InputFeatureTable rows={[row({ lastValueRaw: null })]} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it("shows a derived feature's equation beneath its name", () => {
    render(
      <InputFeatureTable
        rows={[
          row({
            column: 'Reflux_ratio_per_total_feed_of_Quench_oil_tower',
            equation:
              'FIC204.PV/(FY107.CPV+(FIC114A.PV+FIC114B.PV+FIC114C.PV+FIC114D.PV+FIC114I.PV+FIC107R.PV)/1000)',
          }),
        ]}
      />,
    )

    expect(
      screen.getByText('Reflux_ratio_per_total_feed_of_Quench_oil_tower'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'FIC204.PV/(FY107.CPV+(FIC114A.PV+FIC114B.PV+FIC114C.PV+FIC114D.PV+FIC114I.PV+FIC107R.PV)/1000)',
      ),
    ).toBeInTheDocument()
  })

  it('shows no equation for a base tag', () => {
    render(
      <InputFeatureTable
        rows={[row({ column: 'FI001.PV', equation: null })]}
      />,
    )

    // Asserts the cell's full text, not just that the name is present —
    // a regex keyed to another feature's equation shape would pass even
    // if an equation rendered here, as long as it didn't match that shape.
    const cell = screen.getByText('FI001.PV').closest('td')
    expect(cell?.textContent).toBe('FI001.PV')
  })
})
