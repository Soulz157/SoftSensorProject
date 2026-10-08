import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvaluationTooltip } from '../evaluation/evaluation-tooltip'
import { parseServerTimestamp } from '@/lib/monitoring'

const payload = [{ payload: { actual: 12.4, predict: 12.61, residual: -0.21 } }]

describe('EvaluationTooltip header', () => {
  it('names the exact date AND time of the point', () => {
    render(
      <EvaluationTooltip
        active
        label={parseServerTimestamp('2026-02-08 17:30:00')}
        payload={payload}
        variant="fit"
      />,
    )
    expect(screen.getByText('Feb 8, 2026 17:30')).toBeInTheDocument()
  })

  it('keeps the time of day when the chart is zoomed far out (the axis would show the date only)', () => {
    // A multi-day series: the axis formats ticks as "Feb 8", dropping the time.
    render(
      <EvaluationTooltip
        active
        label={parseServerTimestamp('2026-02-08 18:00:00')}
        payload={payload}
        variant="fit"
      />,
    )
    expect(screen.getByText('Feb 8, 2026 18:00')).toBeInTheDocument()
  })

  it('the residual tooltip names the time too', () => {
    render(
      <EvaluationTooltip
        active
        label={parseServerTimestamp('2026-02-08 17:30:00')}
        payload={payload}
        variant="residual"
      />,
    )
    expect(screen.getByText('Feb 8, 2026 17:30')).toBeInTheDocument()
  })

  it('renders nothing when inactive', () => {
    const { container } = render(
      <EvaluationTooltip
        active={false}
        label={parseServerTimestamp('2026-02-08 17:30:00')}
        payload={payload}
        variant="fit"
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
