import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { InputDriftPanel } from '../input-drift/input-drift-panel'
import { mockReport } from './input-drift-fixtures'

/**
 * MODEL-SERVE-036. The Input Drift card, driven by the mockup fixtures
 * (shaped as the planned `/input-drift` response).
 */

function rowButtons() {
  return screen.getAllByRole('button', { expanded: false })
}

describe('InputDriftPanel', () => {
  it('pins the target first, then flagged inputs before healthy ones', () => {
    render(
      <InputDriftPanel
        report={mockReport('24h')}
        loading={false}
        unavailableReason={null}
      />,
    )
    const names = rowButtons().map(
      b => within(b).getByText(/\.(PV|CPV)$/).textContent,
    )
    expect(names[0]).toBe('AI001A2.PV')
    expect(names[1]).toBe('AI206.PV')
    expect(names.at(-1)).toBe('AI001B2.PV')
  })

  it('opens Deep Detail with all four sections and closes again', () => {
    render(
      <InputDriftPanel
        report={mockReport('24h')}
        loading={false}
        unavailableReason={null}
      />,
    )
    const row = screen.getByRole('button', { name: /TI202\.PV/ })
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    for (const title of [
      'Trend',
      'Summary',
      'Distribution vs training',
      'Per window',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Summary' })).toBeNull()
  })

  it('says why an input without a training range has no lines', () => {
    render(
      <InputDriftPanel
        report={mockReport('24h')}
        loading={false}
        unavailableReason={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /AI001B2\.PV/ }))
    expect(
      screen.getByText(/No training range recorded for this input/),
    ).toBeInTheDocument()
  })

  it('states the 31-day cap and the health population', () => {
    render(
      <InputDriftPanel
        report={mockReport('1y')}
        loading={false}
        unavailableReason={null}
      />,
    )
    expect(
      screen.getByText(/Showing the newest 31 days only/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Model health and alerts grade the newest 24 windows/),
    ).toBeInTheDocument()
  })

  it('renders loading, unavailable and empty states', () => {
    const { rerender } = render(
      <InputDriftPanel report={null} loading unavailableReason={null} />,
    )
    expect(screen.getByText('Loading input drift…')).toBeInTheDocument()
    rerender(
      <InputDriftPanel
        report={null}
        loading={false}
        unavailableReason="No PRODUCTION version."
      />,
    )
    expect(screen.getByText('No PRODUCTION version.')).toBeInTheDocument()
    rerender(
      <InputDriftPanel
        report={mockReport('empty')}
        loading={false}
        unavailableReason={null}
      />,
    )
    expect(
      screen.getByText('No input values in this range.'),
    ).toBeInTheDocument()
  })
})
