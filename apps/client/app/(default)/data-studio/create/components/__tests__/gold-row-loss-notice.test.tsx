import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GoldRowLossNotice } from '../gold-row-loss-notice'

const byTag = [
  { tag: 'AI602B.PV', bad: 29880, pct: 81.9 },
  { tag: 'AI602A.PV', bad: 28126, pct: 77.1 },
  { tag: 'LI602.PV', bad: 17146, pct: 47 },
  { tag: 'FIC505.PV', bad: 6274, pct: 17.2 },
]

describe('GoldRowLossNotice', () => {
  it('renders nothing when no row is lost', () => {
    const { container } = render(
      <GoldRowLossNotice
        estimate={{ total: 100, dropped: 0, kept: 100, byTag: [] }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is a neutral note below half the rows', () => {
    render(
      <GoldRowLossNotice
        estimate={{
          total: 36480,
          dropped: 1200,
          kept: 35280,
          byTag: [{ tag: 'FIC318.PV', bad: 1200, pct: 3.3 }],
        }}
      />,
    )
    expect(
      screen.getByText('Saving will remove 1,200 of 36,480 rows (3.3%)'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveClass('text-destructive')
  })

  it('warns at half the rows or more and names the top three tags', () => {
    render(
      <GoldRowLossNotice
        estimate={{ total: 36480, dropped: 36309, kept: 171, byTag }}
      />,
    )
    expect(
      screen.getByText('Saving will remove 36,309 of 36,480 rows (99.5%)'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('text-destructive')
    expect(screen.getByText('AI602B.PV')).toBeInTheDocument()
    expect(screen.getByText('LI602.PV')).toBeInTheDocument()
    expect(screen.queryByText('FIC505.PV')).toBeNull()
  })

  it('says Continue is off when every row would go', () => {
    render(
      <GoldRowLossNotice
        estimate={{ total: 10, dropped: 10, kept: 0, byTag: byTag.slice(0, 1) }}
      />,
    )
    expect(
      screen.getByText('Saving would remove all 10 rows'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Continue stays off until at least one row is kept/),
    ).toBeInTheDocument()
  })

  it('never rounds a partial loss up to 100%', () => {
    render(
      <GoldRowLossNotice
        estimate={{ total: 10000, dropped: 9996, kept: 4, byTag }}
      />,
    )
    expect(
      screen.getByText('Saving will remove 9,996 of 10,000 rows (99.9%)'),
    ).toBeInTheDocument()
  })
})
