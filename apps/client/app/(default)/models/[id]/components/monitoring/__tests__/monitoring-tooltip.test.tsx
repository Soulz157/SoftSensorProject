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

  it('shows the held deviation under Residual rather than a dash', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -3.25 })}
      />,
    )

    // MODEL-SERVE-011-T18 (user decision): same wording as a measured pair.
    // The point is still that a row with nothing to show must not print a
    // dash beside a visible line — it now has a real number instead.
    expect(screen.getByText('Residual')).toBeVisible()
    expect(screen.getByText('-3.25')).toBeVisible()
    expect(screen.queryByText('—')).toBeNull()
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

  it('reports the held deviation under the SAME labels as a measured pair', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -4, heldDeviationPct: -3.51 })}
      />,
    )

    // MODEL-SERVE-011-T17. A 4-unit gap on a 114 reading and one on a 12
    // reading are not the same thing; the percentage is what separates them,
    // and the measured rows already get that pair.
    // MODEL-SERVE-011-T18 (user decision): the same words the measured pair
    // uses. What the number IS lives in the chart caption, not in a longer
    // label.
    expect(screen.getByText('Residual')).toBeVisible()
    expect(screen.getByText('-4.00')).toBeVisible()
    expect(screen.getByText('Error %')).toBeVisible()
    expect(screen.getByText('-3.51%')).toBeVisible()
  })

  it('omits the percentage when the held value made it undefined', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -4 })}
      />,
    )

    // A held value of 0 yields no percentage — undefined, not infinite.
    expect(screen.getByText('Residual')).toBeVisible()
    // Only the absolute row: a held value of 0 yields no percentage.
    expect(screen.queryByText('Error %')).toBeNull()
  })

  it('never shows two Residual rows — a measured pair excludes the held one', () => {
    render(
      <MonitoringTooltip
        active
        label={1}
        variant="residual"
        formatLabel={fmtLabel}
        payload={payload({ t: 1, heldDeviation: -3.25 })}
      />,
    )

    // The collision is avoided by EXCLUSION, mirroring the chart itself:
    // the held series is drawn only when no measured residual exists.
    expect(screen.getAllByText('Residual')).toHaveLength(1)
    expect(screen.getByText('-3.25')).toBeVisible()
  })
})
