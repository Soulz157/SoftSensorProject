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
    frozen: false,
    // MODEL-SERVE-009-T03: required on the row type; null is "unknown
    // duration", which is the honest default for a non-frozen tag.
    frozenFlatMinutes: null,
    // MODEL-SERVE-009-T04: required on the row type. Nulls are the honest
    // default — a fixture with no scheduled-fetch record.
    lastChanged: null,
    fetchStatus: null,
    lastFetchOutcome: null,
    fromScheduledFetch: false,
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

    // Two different questions, two different answers on the same row: a
    // tag can be Bad in PI while its distribution has not drifted at all.
    //
    // Both columns now render the word "Good" — drift's `OK` is displayed
    // as "Good" everywhere since the palette was unified, and PI has
    // always had its own `Good`. So this can no longer be asserted by
    // text alone; each verdict is read from ITS OWN CELL, which is what
    // the test was always really about.
    const badRow = screen.getByText('BAD.PV').closest('tr')!
    const cells = badRow.querySelectorAll('td')
    // Column order: #, Feature, Drift, Status(PI), ... — note the leading
    // row-number cell, so Drift is index 2 and PI is index 3.
    expect(cells[2]?.textContent).toBe('Good')
    expect(cells[3]?.textContent).toBe('Bad')

    const goodRow = screen.getByText('GOOD.PV').closest('tr')!
    const goodCells = goodRow.querySelectorAll('td')
    expect(goodCells[2]?.textContent).toBe('Good')
    expect(goodCells[3]?.textContent).toBe('Good')
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
    // MODEL-SERVE-009-T04 added a second em-dash cell (unknown "last
    // changed"), so this asserts the VALUE cell specifically rather than
    // "some em-dash is on screen" — which would now pass even if the value
    // cell rendered 0.0.
    const valueDashes = screen
      .getAllByText('—')
      .filter(el => el.closest('td')?.className.includes('font-mono'))
    expect(valueDashes).toHaveLength(1)
    expect(valueDashes[0]).toBeVisible()
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

  // The Drift badge carries the same explanation tooltip, wording and
  // palette as the Monitoring tab's card. It briefly kept the raw `OK`
  // token and a neutral treatment to stay clear of the PI badge beside
  // it, which made one verdict render two different ways on two tabs.
  it('renders the Drift verdict as a tooltip trigger, worded like the card', () => {
    render(
      <InputFeatureTable
        rows={[row({ column: 'TI010.PV', driftStatus: 'OK', z: 0.4 })]}
        driftThresholds={{ warnSd: 1.5, criticalSd: 3, outOfRangePct: 10 }}
      />,
    )

    const driftCell = screen
      .getByText('TI010.PV')
      .closest('tr')!
      .querySelectorAll('td')[2]! // #, Feature, Drift

    // Same wording as the Monitoring card — never the raw wire token.
    expect(driftCell.textContent).toBe('Good')
    expect(driftCell.textContent).not.toBe('OK')
    // Radix marks its trigger; a plain <Badge> would have no such button.
    expect(
      driftCell.querySelector('[data-slot="tooltip-trigger"]'),
    ).not.toBeNull()
  })

  it('renders a logged value untouched — no inversion, no "(scaled)" suffix', () => {
    render(<InputFeatureTable rows={[row({ lastValueRaw: 190.42 })]} />)

    expect(screen.getByText('190.42')).toBeInTheDocument()
    expect(screen.queryByText(/scaled/i)).not.toBeInTheDocument()
  })

  it('renders an em-dash when the column was never logged', () => {
    render(<InputFeatureTable rows={[row({ lastValueRaw: null })]} />)

    // Scoped to the value cell — see the note in the V14 case above.
    expect(
      screen
        .getAllByText('—')
        .filter(el => el.closest('td')?.className.includes('font-mono')),
    ).toHaveLength(1)
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

/**
 * MODEL-SERVE-001-T29/T30. The frozen badge is a THIRD verdict, and the
 * negative half is the one that matters: a tag flat in TRAINING (a setpoint,
 * a held-closed valve) is excluded SERVER-SIDE and must never reach this
 * table as frozen. A fixture containing only a stuck tag passes against an
 * implementation that badges every zero-range column.
 */
describe('InputFeatureTable — Sensor Frozen (MODEL-SERVE-001-T30)', () => {
  it('badges a frozen tag', () => {
    render(
      <InputFeatureTable rows={[row({ column: 'TI010.PV', frozen: true })]} />,
    )
    expect(screen.getByText('Frozen')).toBeInTheDocument()
  })

  it('does NOT badge a tag that is not frozen', () => {
    render(
      <InputFeatureTable rows={[row({ column: 'TI010.PV', frozen: false })]} />,
    )
    expect(screen.queryByText('Frozen')).not.toBeInTheDocument()
  })

  it('badges only the frozen tag when both are present', () => {
    render(
      <InputFeatureTable
        rows={[
          row({ column: 'STUCK.PV', frozen: true }),
          row({ column: 'MOVING.PV', frozen: false }),
        ]}
      />,
    )
    expect(screen.getAllByText('Frozen')).toHaveLength(1)
  })

  /** A frozen tag can read PI-Good and un-drifted at the same time — that is
   *  the whole reason this badge exists rather than being folded into one of
   *  its neighbours. */
  it('badges frozen even while PI reports Good and drift reads OK', () => {
    render(
      <InputFeatureTable
        rows={[
          row({
            column: 'TI010.PV',
            frozen: true,
            piStatus: 'Good',
            driftStatus: 'OK',
          }),
        ]}
      />,
    )
    expect(screen.getByText('Frozen')).toBeInTheDocument()

    // Both neighbours read "Good" — drift's `OK` displays as "Good" since
    // the palette was unified, and PI has its own. Read each from its own
    // cell; the point is that a frozen instrument is invisible to BOTH.
    const cells = screen
      .getByText('TI010.PV')
      .closest('tr')!
      .querySelectorAll('td')
    expect(cells[2]?.textContent).toBe('Good') // drift
    // The Frozen badge lives INSIDE the PI cell, so this reads
    // "GoodFrozen" — PI itself still says Good, which is the point.
    expect(cells[3]?.textContent).toBe('GoodFrozen')
  })
})

/**
 * MODEL-SERVE-009-T03. The duration is EVIDENCE beside T29's badge, never a
 * second detector — `frozen` still decides whether the badge renders at all.
 */
describe('frozen duration evidence (MODEL-SERVE-009-T03)', () => {
  it('shows how long a frozen tag has been unchanged', () => {
    render(
      <InputFeatureTable
        rows={[row({ frozen: true, frozenFlatMinutes: 252 })]}
      />,
    )

    // 252 minutes reads as 4h12m — minutes alone stop being legible past the
    // first hour, and these numbers are hours-to-days on a real plant.
    expect(screen.getByText('4h12m')).toBeVisible()
  })

  it('renders the badge with NO duration when the per-tag row is missing', () => {
    render(
      <InputFeatureTable
        rows={[row({ frozen: true, frozenFlatMinutes: null })]}
      />,
    )

    // Unknown stays unstated. Rendering 0 would claim the tag just changed,
    // which is the UNKNOWN-folds-into-a-confident-value defect T27 forbids.
    expect(screen.getByText('Frozen')).toBeVisible()
    expect(screen.queryByText('0m')).toBeNull()
  })

  it('shows no duration for a tag that is not frozen at all', () => {
    render(
      <InputFeatureTable
        rows={[row({ frozen: false, frozenFlatMinutes: 900 })]}
      />,
    )

    // T29 decides the badge; a duration without a badge would be a second
    // detector rendering its own verdict.
    expect(screen.queryByText('Frozen')).toBeNull()
    expect(screen.queryByText('15h')).toBeNull()
  })
})
