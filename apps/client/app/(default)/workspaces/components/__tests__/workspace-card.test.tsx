import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceCard, type WorkspaceCardData } from '../workspace-card'
import { BINARY_STATUS_META } from '@/lib/overview-status'
import type { NodeStatus } from '@/store/status-colors'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

const base: WorkspaceCardData = {
  id: 'ws1',
  ownerId: 'u1',
  name: 'Refinery A',
  icon: 'box',
  color: 'blue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  _count: { members: 2, models: 3 },
  modelsCount: 3,
  plantsCount: 4,
  datasetsCount: 5,
  status: 'normal',
}

const make = (over: Partial<WorkspaceCardData> = {}): WorkspaceCardData => ({
  ...base,
  ...over,
})

describe('WorkspaceCard', () => {
  // -------------------------------------------------------------------------
  // DS-LAKE-029-V01 — the status map bites on the RENDERED output
  // -------------------------------------------------------------------------
  describe('V01 status badge', () => {
    // Every value the wire enum actually carries, not just the two binary ones.
    const cases: Array<[NodeStatus, 'normal' | 'abnormal']> = [
      ['normal', 'normal'],
      ['warning', 'abnormal'],
      ['alarm', 'abnormal'],
      ['offline', 'abnormal'],
    ]

    it.each(cases)(
      'renders the word and class for wire status %s',
      (wire, expected) => {
        const { container } = render(
          <WorkspaceCard workspace={make({ status: wire })} />,
        )
        const meta = BINARY_STATUS_META[expected]

        // The rendered WORD — a shape assertion would pass even if the label
        // fell through to a default (MODEL-SERVE-001-T22).
        expect(screen.getByText(meta.label)).toBeInTheDocument()
        // The rendered CLASS on the status dot.
        expect(container.querySelector(`.${meta.dot}`)).not.toBeNull()
      },
    )

    it('paints an abnormal workspace red and a normal one green', () => {
      const { container: bad } = render(
        <WorkspaceCard workspace={make({ status: 'alarm' })} />,
      )
      expect(bad.querySelector('.bg-red-500')).not.toBeNull()
      expect(bad.querySelector('.bg-green-500')).toBeNull()

      const { container: ok } = render(
        <WorkspaceCard workspace={make({ status: 'normal' })} />,
      )
      expect(ok.querySelector('.bg-green-500')).not.toBeNull()
      expect(ok.querySelector('.bg-red-500')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // DS-LAKE-029-V03 — BOTH sides of unknown-versus-zero
  // -------------------------------------------------------------------------
  describe('V03 unknown is not zero', () => {
    it('renders a genuine zero as 0', () => {
      render(
        <WorkspaceCard
          workspace={make({
            modelsCount: 0,
            plantsCount: 0,
            datasetsCount: 0,
          })}
        />,
      )
      expect(screen.getAllByText('0')).toHaveLength(3)
      expect(screen.queryByText('—')).toBeNull()
    })

    it('renders an omitted count as an em-dash, never as 0', () => {
      render(
        <WorkspaceCard
          workspace={make({
            modelsCount: undefined,
            plantsCount: null,
            datasetsCount: undefined,
          })}
        />,
      )
      expect(screen.getAllByText('—')).toHaveLength(3)
      expect(screen.queryByText('0')).toBeNull()
    })

    it('distinguishes a known count from an unknown one on the same card', () => {
      render(
        <WorkspaceCard
          workspace={make({
            modelsCount: 7,
            plantsCount: undefined,
            datasetsCount: 0,
          })}
        />,
      )
      expect(screen.getByText('7')).toBeInTheDocument()
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // DS-LAKE-029-V04 — the canvas link is gone, the card leads elsewhere
  // -------------------------------------------------------------------------
  describe('V04 links', () => {
    it('no longer links to the canvas', () => {
      const { container } = render(<WorkspaceCard workspace={make()} />)
      const hrefs = Array.from(container.querySelectorAll('a')).map(a =>
        a.getAttribute('href'),
      )
      expect(hrefs.some(h => h?.includes('/canvas'))).toBe(false)
    })

    it('leads to the workspace overview and offers a Models action', () => {
      const { container } = render(<WorkspaceCard workspace={make()} />)
      const hrefs = Array.from(container.querySelectorAll('a')).map(a =>
        a.getAttribute('href'),
      )
      expect(hrefs).toContain('/plants/ws1')
      expect(hrefs).toContain('/models/views')
    })

    it('does not nest the footer actions inside the card-wide link', () => {
      const { container } = render(<WorkspaceCard workspace={make()} />)
      expect(container.querySelector('a a')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // No mock data — docs/CODEBASE.md's no-mock-data rule
  // -------------------------------------------------------------------------
  it('renders no fabricated resource figures', () => {
    render(<WorkspaceCard workspace={make()} />)
    expect(screen.queryByText(/System Resources Allocation/i)).toBeNull()
    expect(screen.queryByText('42%')).toBeNull()
    expect(screen.queryByText('68%')).toBeNull()
  })

  it('never renders the string "undefined" for a count', () => {
    render(
      <WorkspaceCard workspace={make({ modelsCount: undefined })} />,
    )
    expect(screen.queryByText(/undefined/i)).toBeNull()
  })
})
