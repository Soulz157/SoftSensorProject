import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendTooltip } from '../trend-tooltip'

const payload = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `T${i + 1}`,
    value: i + 0.5,
    color: '#123456',
  }))

describe('TrendTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<TrendTooltip payload={payload(3)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the label and every tag for a small chart', () => {
    render(
      <TrendTooltip
        active
        label="2026-01-01T00:00:00Z"
        labelFormatter={() => 'Jan 1, 07:00'}
        payload={payload(3)}
      />,
    )
    expect(screen.getByText('Jan 1, 07:00')).toBeInTheDocument()
    expect(screen.getByText('T3')).toBeInTheDocument()
    expect(screen.queryByText(/more tag/)).toBeNull()
  })

  it('stays bounded at 100 tags: 16 rows and a count of the rest', () => {
    render(<TrendTooltip active label="t" payload={payload(100)} />)
    expect(screen.getByText('T16')).toBeInTheDocument()
    expect(screen.queryByText('T17')).toBeNull()
    expect(screen.getByText(/\+84 more tags/)).toBeInTheDocument()
  })

  it('lists a focused tag even when it is far down the series', () => {
    render(
      <TrendTooltip
        active
        label="t"
        payload={payload(100)}
        focused={['T77']}
      />,
    )
    expect(screen.getByText('T77')).toBeInTheDocument()
  })
})
