import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceRow } from '../workspace-row'
import { BINARY_STATUS_META } from '@/lib/overview-status'
import type { WorkspaceListItem } from '@/lib/workspace-list'
import type { NodeStatus } from '@/store/status-colors'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const base: WorkspaceListItem = {
  id: 'ws1',
  name: 'Refinery A',
  icon: 'box',
  color: 'blue',
  updatedAt: '2026-01-01T00:00:00.000Z',
  modelsCount: 3,
  plantsCount: 4,
  datasetsCount: 5,
  status: 'normal',
  abnormalModels: 0,
}

const make = (over: Partial<WorkspaceListItem> = {}): WorkspaceListItem => ({
  ...base,
  ...over,
})
const renderRow = (ws: WorkspaceListItem) =>
  render(
    <ul>
      <WorkspaceRow ws={ws} />
    </ul>,
  )

describe('WorkspaceRow', () => {
  // DS-LAKE-029-V01 — the status map bites on the RENDERED output
  describe('V01 status badge', () => {
    // MODEL-SERVE-024-D02: only an alerting workspace is Abnormal; warning
    // and offline read Normal.
    const cases: Array<[NodeStatus, 'normal' | 'abnormal']> = [
      ['normal', 'normal'],
      ['warning', 'normal'],
      ['alarm', 'abnormal'],
      ['offline', 'normal'],
    ]

    it.each(cases)(
      'renders the word and class for wire status %s',
      (wire, expected) => {
        const { container } = renderRow(make({ status: wire }))
        const meta = BINARY_STATUS_META[expected]
        expect(screen.getByText(meta.label)).toBeInTheDocument()
        expect(container.querySelector(`.${meta.dot}`)).not.toBeNull()
      },
    )

    it('paints an abnormal workspace red and a normal one green', () => {
      const { container: bad } = renderRow(make({ status: 'alarm' }))
      expect(bad.querySelector('.bg-red-500')).not.toBeNull()
      expect(bad.querySelector('.bg-green-500')).toBeNull()
      const { container: ok } = renderRow(make({ status: 'normal' }))
      expect(ok.querySelector('.bg-green-500')).not.toBeNull()
      expect(ok.querySelector('.bg-red-500')).toBeNull()
    })

    it('an abnormal MODEL makes a normal-node workspace Abnormal and says how many', () => {
      renderRow(make({ status: 'normal', abnormalModels: 2 }))
      expect(screen.getByText('Abnormal')).toBeInTheDocument()
      expect(screen.getByText('2 models need attention')).toBeInTheDocument()
    })

    it('says "1 model needs attention" for one, and nothing for zero or unknown', () => {
      const { unmount } = renderRow(make({ abnormalModels: 1 }))
      expect(screen.getByText('1 model needs attention')).toBeInTheDocument()
      unmount()
      const zero = renderRow(make({ abnormalModels: 0 }))
      expect(zero.container.textContent).not.toMatch(/need.* attention/)
      zero.unmount()
      const { container } = renderRow(make({ abnormalModels: null }))
      expect(container.textContent).not.toMatch(/need.* attention/)
    })

    it('reads "Checking", not Normal, while model status is unknown', () => {
      renderRow(make({ status: 'normal', abnormalModels: null }))
      expect(screen.getByText('Checking')).toBeInTheDocument()
      expect(screen.queryByText('Normal')).toBeNull()
    })

    it('labels the updated time for screen readers', () => {
      renderRow(make())
      expect(screen.getByText('Updated')).toHaveClass('sr-only')
    })
  })

  // DS-LAKE-029-V03 — BOTH sides of unknown-versus-zero
  describe('V03 unknown is not zero', () => {
    it('renders a genuine zero as 0', () => {
      renderRow(make({ modelsCount: 0, plantsCount: 0, datasetsCount: 0 }))
      expect(screen.getAllByText('0')).toHaveLength(3)
      expect(screen.queryByText('—')).toBeNull()
    })

    it('renders an omitted count as an em-dash, never as 0', () => {
      renderRow(
        make({
          modelsCount: undefined,
          plantsCount: null,
          datasetsCount: undefined,
        }),
      )
      expect(screen.getAllByText('—')).toHaveLength(3)
      expect(screen.queryByText('0')).toBeNull()
    })

    it('distinguishes a known count from an unknown one on the same row', () => {
      renderRow(
        make({ modelsCount: 7, plantsCount: undefined, datasetsCount: 0 }),
      )
      expect(screen.getByText('7')).toBeInTheDocument()
      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('tells a screen reader which count is unknown', () => {
      renderRow(make({ plantsCount: undefined }))
      expect(screen.getByText('plants unknown')).toBeInTheDocument()
    })
  })

  // DS-LAKE-029-V04 — the canvas link is gone, the row leads elsewhere
  describe('V04 links', () => {
    const hrefs = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('a')).map(a => a.getAttribute('href'))

    it('no longer links to the canvas', () => {
      const { container } = renderRow(make())
      expect(hrefs(container).some(h => h?.includes('/canvas'))).toBe(false)
    })

    it('leads to the workspace overview and opens Models filtered to THIS workspace', () => {
      const { container } = renderRow(make())
      expect(hrefs(container)).toContain('/plants/ws1')
      expect(hrefs(container)).toContain('/models/views?workspace=ws1')
    })

    it('does not nest the row actions inside the row-wide link', () => {
      const { container } = renderRow(make())
      expect(container.querySelector('a a')).toBeNull()
    })

    it('names each action after its workspace', () => {
      renderRow(make())
      expect(
        screen.getByRole('link', { name: 'Refinery A models' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Refinery A settings' }),
      ).toBeInTheDocument()
    })
  })

  // docs/CODEBASE.md's no-mock-data rule
  it('renders no fabricated resource figures', () => {
    renderRow(make())
    expect(screen.queryByText(/System Resources Allocation/i)).toBeNull()
    expect(screen.queryByText('42%')).toBeNull()
  })

  it('never renders the string "undefined" for a count', () => {
    renderRow(make({ modelsCount: undefined }))
    expect(screen.queryByText(/undefined/i)).toBeNull()
  })
})
