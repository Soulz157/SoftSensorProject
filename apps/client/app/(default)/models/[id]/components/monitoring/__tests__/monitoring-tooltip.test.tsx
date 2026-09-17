import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonitoringTooltip } from '../monitoring-tooltip'

/**
 * MODEL-SERVE-011-T09. The Actual vs Predict crosshair sat on a VISIBLE
 * point and read "Actual — / Predict —".
 *
 * The cause was not missing data. `LiveOverlayRow` keeps `live`, `held` and
 * `heldDeviation` under their own keys ON PURPOSE — `held` must never reach
 * the residual or the SD band, and a window's prediction and a /predict row
 * are different artifacts — and the chart draws all three. The tooltip was
 * the one reader still typed to `MonitoringRow` alone, so it had no row for
 * any of them.
 *
 * Every assertion below is on the VALUE and its LABEL together: a number
 * with the wrong label is the defect this fix exists to avoid, not a
 * cosmetic difference.
 */

const fmtLabel = () => '14:05'
const payload = (row: Record<string, number>) => [{ payload: row }]

describe('MonitoringTooltip — live-overlay points (MODEL-SERVE-011-T09)', () => {
  it('shows a scheduled window\u2019s own value as Predict, not two dashes', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, scheduled: 110.33 })}
      />,
    )

    // MODEL-SERVE-011-T13. This chart carries only the WINDOW plane now, so
    // the hourly summary is simply "Predict" — there is no other prediction
    // on this axis for the word to be confused with.
    expect(screen.getByText('Predict')).toBeVisible()
    expect(screen.getByText('110.33')).toBeVisible()
    // The measured pair does NOT exist on this row, so claiming it with two
    // dashes is what was wrong \u2014 not merely unhelpful.
    expect(screen.queryByText('Actual')).toBeNull()
  })

  it('qualifies the hourly value only when a paired prediction shares the row', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, actual: 12.5, predict: 13.75, scheduled: 14 })}
      />,
    )

    // Two identical labels holding different numbers would be worse than a
    // longer one.
    expect(screen.getByText('Predict')).toBeVisible()
    expect(screen.getByText('Predict (hour avg)')).toBeVisible()
    expect(screen.getByText('14.00')).toBeVisible()
  })

  it('no longer renders the live serving-plane row on this chart', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, live: 87.25 })}
      />,
    )

    // The live series was removed from Actual vs Predict (user decision
    // 2026-09-17); it keeps its own section below. The key still exists on
    // the row type because the Residual chart populates it.
    expect(screen.queryByText('Predict (live)')).toBeNull()
    expect(screen.queryByText('87.25')).toBeNull()
  })

  it('names a held value as last reported, never as a measured Actual', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, scheduled: 110.33, held: 90.5 })}
      />,
    )

    // The chart draws this under the Actual identity; the tooltip is where
    // a reader asks what the number IS, and it was not measured in this
    // interval.
    expect(screen.getByText('Actual (last reported)')).toBeVisible()
    expect(screen.getByText('90.50')).toBeVisible()
  })

  it('leaves a measured pair exactly as it was', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, actual: 12.5, predict: 13.75 })}
      />,
    )

    expect(screen.getByText('Actual')).toBeVisible()
    expect(screen.getByText('12.50')).toBeVisible()
    expect(screen.getByText('Predict')).toBeVisible()
    expect(screen.getByText('13.75')).toBeVisible()
    expect(screen.queryByText('Predict (live)')).toBeNull()
  })

  it('still renders the pair, dashed, on a row that carries nothing', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="main"
        formatLabel={fmtLabel}
        payload={payload({ t: 1 })}
      />,
    )

    // An empty box would read as a broken tooltip; two dashes on a row with
    // genuinely nothing is honest.
    expect(screen.getByText('Actual')).toBeVisible()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('does not claim an uncomputable residual on a live-overlay point', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -3.25 })}
      />,
    )

    // A residual and an error % exist only for a MEASURED pair. Two dashes
    // beside a visible point say "this could not be computed" about a point
    // that was never in that calculation.
    expect(screen.queryByText('Residual')).toBeNull()
    expect(screen.queryByText('Error %')).toBeNull()
    expect(screen.getByText('Vs last reported')).toBeVisible()
  })

  it('keeps the dashed residual pair on a row that carries nothing at all', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1 })}
      />,
    )

    expect(screen.getByText('Residual')).toBeVisible()
    expect(screen.getByText('Error %')).toBeVisible()
  })

  it('reports a held deviation without calling it a residual', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -3.25 })}
      />,
    )

    // `live - held` is measured against a value carried forward since the
    // lab last reported — excluded from RMSE/R2/SD for that reason, so its
    // label must not borrow the residual's name.
    expect(screen.getByText('Vs last reported')).toBeVisible()
    expect(screen.getByText('-3.25')).toBeVisible()
  })
})
