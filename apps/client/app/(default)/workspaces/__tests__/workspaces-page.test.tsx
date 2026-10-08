import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Workspace } from '@/types'

const getNodesSpy = vi.fn()
const useWorkspacesMock = vi.fn()
const useAllModelsMock = vi.fn()

vi.mock('@/services/canvas', () => ({
  getNodes: (...args: unknown[]) => getNodesSpy(...args),
}))

vi.mock('@/hooks/workspace/use-workspaces', () => ({
  useWorkspaces: () => useWorkspacesMock(),
}))

vi.mock('@/hooks/use-all-models', () => ({
  useAllModels: () => useAllModelsMock(),
}))

vi.mock('@/components/create-workspace', () => ({
  CreateWorkspaceDialog: () => null,
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

import WorkspacesPage from '../page'

const makeWorkspace = (i: number): Workspace => ({
  id: `ws${i}`,
  ownerId: 'u1',
  name: `Workspace ${String(i).padStart(2, '0')}`,
  icon: 'box',
  color: 'blue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  _count: { members: 1, models: 2 },
  modelsCount: 2,
  plantsCount: 3,
  datasetsCount: 4,
  status: 'normal',
})

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => makeWorkspace(i + 1))
// The summary is split across spans; read the whole line. The breadcrumb is
// also a list, so workspace rows are scoped to the `role="list"` ul.
const summary = () =>
  (screen.getByTestId('workspaces-summary').textContent ?? '').replace(
    /\s+/g,
    ' ',
  )
const rowNames = () =>
  rows().map(r => within(r).getAllByRole('link')[0]!.textContent)
const rows = () =>
  Array.from(document.querySelectorAll('ul[role="list"] > li')) as HTMLElement[]

describe('WorkspacesPage', () => {
  beforeAll(() => {
    // jsdom has no scrollIntoView; the pager calls it on page change.
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    getNodesSpy.mockClear()
    useWorkspacesMock.mockReset()
    useAllModelsMock.mockReset()
    // Models loaded, none abnormal, unless a test says otherwise.
    useAllModelsMock.mockReturnValue({ models: [] })
  })

  // DS-LAKE-029-V02 — the N+1 is gone (client half). A regression guard: the
  // page does not import the canvas service at all today.
  it('issues no per-workspace node request, for one workspace or for fifty', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: many(1), loading: false })
    render(<WorkspacesPage />)
    expect(getNodesSpy).not.toHaveBeenCalled()

    useWorkspacesMock.mockReturnValue({ workspaces: many(50), loading: false })
    render(<WorkspacesPage />)
    expect(getNodesSpy).not.toHaveBeenCalled()
  })

  // T05 — the skeleton is reachable
  it('renders row skeletons while loading, not a full-page spinner', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: [], loading: true })
    const { container } = render(<WorkspacesPage />)
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/Loading workspaces/i)).toBeNull()
    expect(screen.queryByText(/No workspaces yet/i)).toBeNull()
  })

  // T05 — the empty state REPLACES the list
  it('shows the empty state instead of an empty list', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: [], loading: false })
    render(<WorkspacesPage />)
    expect(screen.getByText(/No workspaces yet/i)).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull()
  })

  it('renders the list and no empty state once workspaces exist', () => {
    useWorkspacesMock.mockReturnValue({ workspaces: many(2), loading: false })
    render(<WorkspacesPage />)
    expect(screen.queryByText(/No workspaces yet/i)).toBeNull()
    expect(screen.getByText('Workspace 01')).toBeInTheDocument()
    expect(screen.getByText('Workspace 02')).toBeInTheDocument()
  })

  // Summary follows the unknown-is-not-zero rule
  it('sums the model counts when every workspace supplies one', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { ...makeWorkspace(1), modelsCount: 2 },
        { ...makeWorkspace(2), modelsCount: 5 },
      ],
      loading: false,
    })
    render(<WorkspacesPage />)
    expect(summary()).toContain('7 models')
  })

  it('renders the total as an em-dash when any count is unknown, not as 0', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { ...makeWorkspace(1), modelsCount: 2 },
        { ...makeWorkspace(2), modelsCount: undefined },
      ],
      loading: false,
    })
    const { container } = render(<WorkspacesPage />)
    expect(summary()).toContain('— models')
    expect(container.textContent).not.toContain('NaN')
  })

  it('reports a genuine zero total as 0', () => {
    useWorkspacesMock.mockReturnValue({
      workspaces: [{ ...makeWorkspace(1), modelsCount: 0 }],
      loading: false,
    })
    render(<WorkspacesPage />)
    expect(summary()).toContain('0 models')
  })

  // Review finding (Opus 5.5, Gate 1): never claim "0 need attention" while
  // the model list has not loaded.
  it('shows attention as unknown until the models load', () => {
    useAllModelsMock.mockReturnValue({ models: null })
    useWorkspacesMock.mockReturnValue({ workspaces: many(3), loading: false })
    render(<WorkspacesPage />)
    expect(summary()).toContain('— need attention')
    expect(
      screen.getByRole('radio', { name: 'Needs attention, unknown' }),
    ).toBeInTheDocument()
    // Rows don't claim Normal either (Gate 2 finding).
    expect(screen.getAllByText('Checking')).toHaveLength(3)
    expect(rows().some(r => /Normal/.test(r.textContent ?? ''))).toBe(false)
  })

  it('keeps unknown workspaces out of the Normal filter, and leads with alerting nodes', () => {
    useAllModelsMock.mockReturnValue({ models: null })
    useWorkspacesMock.mockReturnValue({
      workspaces: [
        makeWorkspace(1),
        makeWorkspace(2),
        { ...makeWorkspace(3), status: 'alarm' },
      ],
      loading: false,
    })
    render(<WorkspacesPage />)
    // Name order, but the alerting node is already known to be Abnormal.
    expect(rowNames()).toEqual(['Workspace 03', 'Workspace 01', 'Workspace 02'])
    fireEvent.click(screen.getByRole('radio', { name: /^Normal/ }))
    expect(rows()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(
      'No workspace is reading Normal',
    )
  })

  it('moves only the model-abnormal workspace up when the models arrive', () => {
    useAllModelsMock.mockReturnValue({ models: null })
    useWorkspacesMock.mockReturnValue({ workspaces: many(4), loading: false })
    const { rerender } = render(<WorkspacesPage />)
    expect(rowNames()).toEqual([
      'Workspace 01',
      'Workspace 02',
      'Workspace 03',
      'Workspace 04',
    ])
    useAllModelsMock.mockReturnValue({
      models: [
        { workspaceId: 'ws3', data: { monitoring: { status: 'ALERT' } } },
      ],
    })
    rerender(<WorkspacesPage />)
    expect(rowNames()).toEqual([
      'Workspace 03',
      'Workspace 01',
      'Workspace 02',
      'Workspace 04',
    ])
  })

  it('offers a retry when model status fails to load', () => {
    const refetch = vi.fn()
    useAllModelsMock.mockReturnValue({
      models: null,
      error: 'boom',
      refetch,
    })
    useWorkspacesMock.mockReturnValue({ workspaces: many(2), loading: false })
    render(<WorkspacesPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load model status",
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('counts a workspace with an abnormal model as needing attention, and lists it first', () => {
    // `monitoring.status === 'ALERT'` is abnormal under the shared rule
    // (lib/model-status `isModelAbnormal`), the same one the sidebar uses.
    useAllModelsMock.mockReturnValue({
      models: [
        { workspaceId: 'ws3', data: { monitoring: { status: 'ALERT' } } },
        { workspaceId: 'ws1', data: { monitoring: { status: 'OK' } } },
      ],
    })
    useWorkspacesMock.mockReturnValue({ workspaces: many(3), loading: false })
    render(<WorkspacesPage />)
    const first = rows()[0]!
    expect(within(first).getByText('Workspace 03')).toBeInTheDocument()
    expect(within(first).getByText('Abnormal')).toBeInTheDocument()
    expect(
      within(first).getByText('1 model needs attention'),
    ).toBeInTheDocument()
    expect(summary()).toContain('1 needs attention')
    expect(summary()).not.toContain('0 need')
  })

  // User's call 2026-10-07: 15 workspaces per page
  describe('pagination', () => {
    it('shows 15 workspaces per page and a range', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(40),
        loading: false,
      })
      render(<WorkspacesPage />)
      expect(rows()).toHaveLength(15)
      expect(screen.getByText('1–15 of 40')).toBeInTheDocument()
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Previous page' }),
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('moves to the next page and back', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(40),
        loading: false,
      })
      render(<WorkspacesPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByText('16–30 of 40')).toBeInTheDocument()
      expect(screen.getByText('Workspace 16')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(rows()).toHaveLength(10)
      const next = screen.getByRole('button', { name: 'Next page' })
      expect(next).toHaveAttribute('aria-disabled', 'true')
      // Clicking the end does nothing — and the button keeps focus.
      next.focus()
      fireEvent.click(next)
      expect(screen.getByText('31–40 of 40')).toBeInTheDocument()
      expect(document.activeElement).toBe(next)
      fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
      expect(screen.getByText('16–30 of 40')).toBeInTheDocument()
    })

    it('shows no pager for 15 workspaces or fewer', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(15),
        loading: false,
      })
      render(<WorkspacesPage />)
      expect(
        screen.queryByRole('navigation', { name: /pagination/i }),
      ).toBeNull()
      expect(rows()).toHaveLength(15)
    })

    // The search still matches more than one page, so only a real reset to
    // page 1 makes "1–15" appear — clamping alone would leave page 3.
    it('starts again from page 1 when the search changes', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(60),
        loading: false,
      })
      render(<WorkspacesPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByText('31–45 of 60')).toBeInTheDocument()
      fireEvent.change(screen.getByPlaceholderText('Search workspaces'), {
        target: { value: 'Workspace' },
      })
      expect(screen.getByText('1–15 of 60')).toBeInTheDocument()
    })

    it('starts again from page 1 when the status filter changes', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(60),
        loading: false,
      })
      render(<WorkspacesPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByText('31–45 of 60')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: /^Normal/ }))
      expect(screen.getByText('1–15 of 60')).toBeInTheDocument()
    })

    it('stays on a valid page when the list shrinks under it', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(40),
        loading: false,
      })
      const { rerender } = render(<WorkspacesPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      expect(screen.getByText('31–40 of 40')).toBeInTheDocument()
      useWorkspacesMock.mockReturnValue({
        workspaces: many(20),
        loading: false,
      })
      rerender(<WorkspacesPage />)
      expect(screen.getByText('16–20 of 20')).toBeInTheDocument()
      // Growing again does not jump back to the page the user left.
      useWorkspacesMock.mockReturnValue({
        workspaces: many(40),
        loading: false,
      })
      rerender(<WorkspacesPage />)
      expect(screen.getByText('16–30 of 40')).toBeInTheDocument()
    })

    it('says so when nothing matches, instead of showing an empty page', () => {
      useWorkspacesMock.mockReturnValue({
        workspaces: many(20),
        loading: false,
      })
      render(<WorkspacesPage />)
      fireEvent.change(screen.getByPlaceholderText('Search workspaces'), {
        target: { value: 'no such workspace' },
      })
      expect(screen.getByRole('status')).toHaveTextContent(
        'No workspace matches your search',
      )
      expect(
        screen.queryByRole('navigation', { name: /pagination/i }),
      ).toBeNull()
    })
  })
})
