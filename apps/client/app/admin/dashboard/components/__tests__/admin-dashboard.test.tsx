import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AttentionQueue } from '../attention-queue'
import { AdminWorkspaceTable } from '../admin-workspace-table'
import { AdminDashboardView } from '../admin-dashboard-view'
import { paginate } from '@/lib/workspace-list'
import type { AdminWorkspace, AdminWorkspaceSummary } from '@/types'

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

const owner = { id: 'o', firstName: 'Mock', lastName: 'A', email: 'a@x.test' }

const ws = (over: Partial<AdminWorkspace> = {}): AdminWorkspace => ({
  id: 'w1',
  name: 'Mock Workspace',
  color: 'blue',
  icon: 'box',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  owner,
  _count: { models: 2 },
  modelsCount: 2,
  plantsCount: 3,
  datasetsCount: 4,
  nodeCount: 5,
  alarmCount: 0,
  warningCount: 0,
  offlineCount: 0,
  status: 'normal',
  ...over,
})

const attentionItem = (over = {}) => ({
  id: 'a1',
  name: 'Mock Alarm',
  owner,
  status: 'alarm' as const,
  alarmCount: 2,
  warningCount: 1,
  offlineCount: 1,
  ...over,
})

const noop = () => {}

describe('AttentionQueue', () => {
  it('says plainly that nothing needs attention (neutral, not an all-clear)', () => {
    render(<AttentionQueue state="ready" items={[]} total={0} onRetry={noop} />)
    expect(
      screen.getByText('No workspace needs attention.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an error with a retry — never an empty (healthy) queue', () => {
    const onRetry = vi.fn()
    render(
      <AttentionQueue state="error" items={[]} total={0} onRetry={onRetry} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load")
    expect(screen.queryByText('No workspace needs attention.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('colours only the alarm part; warnings and offline stay muted', () => {
    render(
      <AttentionQueue
        state="ready"
        items={[attentionItem()]}
        total={1}
        onRetry={noop}
      />,
    )
    const alarm = screen.getByText('2 in alarm')
    expect(alarm.className).toMatch(/text-red/)
    expect(screen.getByText(/1 warning · 1 offline/).className).not.toMatch(
      /text-red/,
    )
  })

  it('links to the ADMIN workspace page, not a user route', () => {
    render(
      <AttentionQueue
        state="ready"
        items={[attentionItem()]}
        total={1}
        onRetry={noop}
      />,
    )
    expect(screen.getByRole('link', { name: 'Mock Alarm' })).toHaveAttribute(
      'href',
      '/admin/workspaces/a1/settings',
    )
  })

  it('says how many more are in alarm when the list is capped', () => {
    render(
      <AttentionQueue
        state="ready"
        items={[attentionItem(), attentionItem({ id: 'a2', name: 'Mock Two' })]}
        total={14}
        onRetry={noop}
      />,
    )
    expect(
      screen.getByText(/and 12 more workspaces in alarm/),
    ).toBeInTheDocument()
  })

  it('announces loading once and hides the skeleton from screen readers', () => {
    const { container } = render(
      <AttentionQueue state="loading" items={[]} total={0} onRetry={noop} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(container.querySelector('ul[aria-hidden]')).not.toBeNull()
  })
})

function table(items: AdminWorkspace[], over = {}) {
  return (
    <AdminWorkspaceTable
      state="ready"
      items={items}
      page={paginate(items, 1)}
      search=""
      searching={false}
      onSearch={noop}
      onPage={noop}
      onRetry={noop}
      {...over}
    />
  )
}

describe('AdminWorkspaceTable', () => {
  it('renders the status word, owner and real counts', () => {
    render(table([ws({ status: 'alarm', alarmCount: 2 })]))
    expect(screen.getByText('Abnormal')).toBeInTheDocument()
    expect(screen.getByText('Owner: Mock A')).toBeInTheDocument()
    expect(screen.getByText('2 in alarm')).toBeInTheDocument()
  })

  it('renders an absent count as "—", never 0', () => {
    render(
      table([
        ws({
          modelsCount: undefined,
          plantsCount: undefined,
          datasetsCount: undefined,
        }),
      ]),
    )
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('does not call a workspace without equipment Normal', () => {
    render(table([ws({ nodeCount: 0 })]))
    expect(screen.getByText('No equipment')).toBeInTheDocument()
    expect(screen.queryByText('Normal')).toBeNull()
  })

  it('names the status column for screen readers and phones', () => {
    render(table([ws()]))
    expect(
      screen.getByText('Equipment status', { selector: 'span.text-xs' }),
    ).toBeInTheDocument()
  })

  it('error is an error with a retry, not an empty list', () => {
    render(table([], { state: 'error' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load workspaces",
    )
    expect(screen.queryByText('No workspaces yet')).toBeNull()
  })

  it('says "No workspaces yet" only when the platform has none', () => {
    render(table([]))
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument()
  })

  it('blames the search only when the rows on screen were fetched with one', () => {
    render(table([], { search: 'zzz', searching: true }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'No workspace matches your search',
    )
  })

  it('clearing the search does not flash "No workspaces yet" while the old empty result is still showing', () => {
    // Input already cleared, rows still those of the old term.
    render(table([], { search: '', searching: true }))
    expect(screen.queryByText('No workspaces yet')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'No workspace matches your search',
    )
  })

  it('an out-of-range page during a search is "this page is empty", not "no match"', () => {
    render(
      table([], {
        searching: true,
        search: 'mock',
        page: {
          ...paginate(Array.from({ length: 40 }), 1),
          items: [],
          page: 4,
        },
      }),
    )
    expect(screen.queryByText(/No workspace matches/)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('This page is empty')
  })

  it('dims the rows and marks the section busy while a request is in flight', () => {
    const { container } = render(table([ws()], { fetching: true }))
    expect(container.querySelector('section')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(container.querySelector('.opacity-60')).not.toBeNull()
  })

  it('never says "none yet" for an out-of-range page of a non-empty platform', () => {
    const onPage = vi.fn()
    render(
      table([], {
        page: {
          ...paginate(Array.from({ length: 40 }), 1),
          items: [],
          page: 4,
        },
        onPage,
      }),
    )
    expect(screen.queryByText('No workspaces yet')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('This page is empty')
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the first page' }),
    )
    expect(onPage).toHaveBeenCalledWith(1)
  })

  it('row links go to the admin workspace page and nothing nests', () => {
    const { container } = render(table([ws()]))
    expect(
      screen.getByRole('link', { name: 'Mock Workspace' }),
    ).toHaveAttribute('href', '/admin/workspaces/w1/settings')
    expect(container.querySelector('a a')).toBeNull()
  })
})

const summaryOf = (
  over: Partial<AdminWorkspaceSummary> = {},
): AdminWorkspaceSummary => ({
  total: 12,
  models: 46,
  attentionTotal: 2,
  attention: [attentionItem(), attentionItem({ id: 'a2', name: 'Mock Two' })],
  ...over,
})

function view(layout: 'ops' | 'console', over: Record<string, unknown> = {}) {
  return (
    <AdminDashboardView
      layout={layout}
      summary={{ state: 'ready', data: summaryOf(), onRetry: noop }}
      users={38}
      table={{
        state: 'ready',
        items: [ws()],
        page: paginate([ws()], 1),
        search: '',
        searching: false,
        onSearch: noop,
        onPage: noop,
        onRetry: noop,
      }}
      activity={{ state: 'ready', items: [], onRetry: noop }}
      onCreate={noop}
      {...over}
    />
  )
}

describe('AdminDashboardView', () => {
  const text = () => screen.getByTestId('admin-summary').textContent

  it('builds the summary line from the real totals', () => {
    render(view('ops'))
    expect(text()).toBe(
      '12 workspaces · 2 need attention · 46 models · 38 users',
    )
  })

  it('uses the TRUE alarm total, not the capped list length', () => {
    render(
      view('ops', {
        summary: {
          state: 'ready',
          data: summaryOf({ attentionTotal: 14 }),
          onRetry: noop,
        },
      }),
    )
    expect(text()).toContain('14 need attention')
  })

  it('shows "—" for everything while loading or after an error', () => {
    render(
      view('ops', {
        summary: { state: 'error', data: null, onRetry: noop },
        users: null,
      }),
    )
    // The figure is an aria-hidden "—" with an sr-only "unknown".
    expect(text()).toBe(
      '—unknown workspaces · —unknown need attention · —unknown models · —unknown users',
    )
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('keeps one DOM order everywhere: attention, table, activity', () => {
    const { container } = render(view('ops'))
    const h2 = Array.from(container.querySelectorAll('h2')).map(
      h => h.textContent,
    )
    expect(h2).toEqual(['Needs attention', 'Workspaces', 'Recent activity'])
  })

  it('has no fabricated figures from the old dashboard', () => {
    const { container } = render(view('ops'))
    for (const fake of [
      '+2 this month',
      'Operational',
      'In Progress',
      'Running',
    ]) {
      expect(container.textContent).not.toContain(fake)
    }
  })

  it('console layout hides the strip when nothing needs attention, but not on error', () => {
    const calm = summaryOf({ attentionTotal: 0, attention: [] })
    const { rerender } = render(
      view('console', {
        summary: { state: 'ready', data: calm, onRetry: noop },
      }),
    )
    expect(
      screen.queryByRole('heading', { name: 'Needs attention' }),
    ).toBeNull()
    rerender(
      view('console', {
        summary: { state: 'error', data: null, onRetry: noop },
      }),
    )
    expect(
      screen.getByRole('heading', { name: 'Needs attention' }),
    ).toBeInTheDocument()
  })
})
