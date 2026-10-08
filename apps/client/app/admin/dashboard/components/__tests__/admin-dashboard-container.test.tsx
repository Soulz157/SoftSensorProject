import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const summary = vi.fn()
const workspaces = vi.fn()
const users = vi.fn()
const activity = vi.fn()
const refetchSummary = vi.fn()
const refetchWorkspaces = vi.fn()

vi.mock('@/hooks/admin/use-admin-workspace-summary', () => ({
  useAdminWorkspaceSummary: () => summary(),
}))
vi.mock('@/hooks/admin/use-admin-workspaces', () => ({
  useAdminWorkspaces: (args: unknown) => workspaces(args),
}))
vi.mock('@/hooks/admin/use-activity', () => ({
  useUserStats: () => users(),
  useActivityLog: () => activity(),
}))
vi.mock('@/components/create-workspace', () => ({
  CreateWorkspaceDialog: ({
    open,
    onClose,
  }: {
    open: boolean
    onClose: () => void
  }) => (open ? <button onClick={onClose}>close dialog</button> : null),
}))
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

import { AdminDashboard } from '../admin-dashboard'

const owner = { id: 'o', firstName: 'Mock', lastName: 'A', email: 'a@x.test' }
const item = (i: number) => ({
  id: `w${i}`,
  name: `Mock ${i}`,
  color: 'blue',
  icon: 'box',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  owner,
  _count: { models: 1 },
  modelsCount: 1,
  plantsCount: 1,
  datasetsCount: 1,
  nodeCount: 1,
  alarmCount: 0,
  warningCount: 0,
  offlineCount: 0,
  status: 'normal' as const,
})

const ok = () => {
  summary.mockReturnValue({
    data: { total: 2, models: 2, attentionTotal: 0, attention: [] },
    error: null,
    refetch: refetchSummary,
  })
  workspaces.mockReturnValue({
    data: { items: [item(1), item(2)], total: 2, page: 1, limit: 15 },
    error: null,
    refetch: refetchWorkspaces,
  })
  users.mockReturnValue({ data: { items: [], total: 7, page: 1, limit: 1 } })
  activity.mockReturnValue({
    data: { items: [], total: 0, page: 1, limit: 8 },
    error: null,
    refetch: vi.fn(),
  })
}

describe('AdminDashboard (wired)', () => {
  beforeEach(() => {
    for (const m of [
      summary,
      workspaces,
      users,
      activity,
      refetchSummary,
      refetchWorkspaces,
    ])
      m.mockReset()
    ok()
  })

  it('shows real totals and asks the API for 15 per page', () => {
    render(<AdminDashboard />)
    expect(screen.getByTestId('admin-summary').textContent).toBe(
      '2 workspaces · 0 need attention · 2 models · 7 users',
    )
    expect(workspaces).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 15 }),
    )
  })

  it('a failed summary is an error, even if it still holds old data', () => {
    summary.mockReturnValue({
      data: { total: 2, models: 2, attentionTotal: 0, attention: [] },
      error: 'boom',
      refetch: refetchSummary,
    })
    render(<AdminDashboard />)
    // Error wins: no "No workspace needs attention." beside stale numbers.
    expect(screen.queryByText('No workspace needs attention.')).toBeNull()
    expect(
      screen.getByText("Couldn't load which workspaces need attention."),
    ).toBeInTheDocument()
  })

  it('each section fails on its own', () => {
    activity.mockReturnValue({ data: null, error: 'boom', refetch: vi.fn() })
    render(<AdminDashboard />)
    expect(screen.getByText("Couldn't load activity.")).toBeInTheDocument()
    expect(screen.getByText('Mock 1')).toBeInTheDocument()
  })

  it('reads an unknown users total as unknown, not as 0', () => {
    users.mockReturnValue({ data: null })
    render(<AdminDashboard />)
    expect(screen.getByTestId('admin-summary').textContent).toContain(
      'unknown users',
    )
  })

  it('labels the range from the page the server answered with', () => {
    // The user asked for page 2 but the old page-1 rows are still on screen.
    workspaces.mockReturnValue({
      data: { items: [item(1)], total: 40, page: 1, limit: 15 },
      error: null,
      isFetching: true,
      refetch: refetchWorkspaces,
    })
    render(<AdminDashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('1–1 of 40')).toBeInTheDocument()
    expect(screen.queryByText(/16–/)).toBeNull()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('shows loading while nothing has arrived', () => {
    summary.mockReturnValue({
      data: null,
      error: null,
      refetch: refetchSummary,
    })
    workspaces.mockReturnValue({
      data: null,
      error: null,
      refetch: refetchWorkspaces,
    })
    render(<AdminDashboard />)
    // "—" is aria-hidden; screen readers hear "unknown".
    expect(screen.getByTestId('admin-summary').textContent).toContain(
      'unknown workspaces',
    )
    expect(screen.getByText('Loading workspaces')).toBeInTheDocument()
  })

  describe('search (debounced 300 ms)', () => {
    const args = () =>
      workspaces.mock.calls.map(c => c[0] as { page: number; search?: string })
    const type = (value: string) =>
      fireEvent.change(screen.getByPlaceholderText('Search workspaces'), {
        target: { value },
      })

    beforeEach(() => {
      vi.useFakeTimers()
      workspaces.mockReturnValue({
        data: { items: [item(1)], total: 40, page: 1, limit: 15 },
        error: null,
        refetch: refetchWorkspaces,
      })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('sends the TRIMMED term only after the pause, and resets to page 1 without a wasted request', () => {
      render(<AdminDashboard />)
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(args().at(-1)).toMatchObject({ page: 2, search: undefined })

      const before = args().length
      type('  abc ')
      // Typed, not yet debounced: the list is NOT re-requested (no unfiltered
      // page-1 request for the old term).
      expect(
        args()
          .slice(before)
          .every(a => a.page === 2),
      ).toBe(true)

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(args().at(-1)).toEqual({ page: 1, limit: 15, search: 'abc' })
    })

    it('never sends a whitespace-only term', () => {
      render(<AdminDashboard />)
      type('   ')
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(args().every(a => a.search === undefined)).toBe(true)
    })
  })

  it('refreshes the summary and list after the create dialog closes', () => {
    render(<AdminDashboard />)
    fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }))
    fireEvent.click(screen.getByRole('button', { name: 'close dialog' }))
    expect(refetchSummary).toHaveBeenCalled()
    expect(refetchWorkspaces).toHaveBeenCalled()
  })
})
