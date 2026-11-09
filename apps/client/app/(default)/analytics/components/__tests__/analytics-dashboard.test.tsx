import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type {
  AllWorkspacesIntake,
  TagCounts,
  WorkspaceIntake,
} from '@/types/data-intake'

const intake = vi.fn()
const workspacesHook = vi.fn()
const session = vi.fn()
const refetch = vi.fn()

vi.mock('@/hooks/analytics/use-data-intake', () => ({
  useDataIntake: (scope: unknown, range: unknown, enabled: unknown) =>
    intake(scope, range, enabled),
}))
vi.mock('@/hooks/workspace/use-workspaces', () => ({
  useWorkspaces: () => workspacesHook(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => session() }))
// recharts needs layout jsdom does not have; the chart is covered by the lib
// tests (series building) and its own empty state below.
vi.mock('../ingestion-chart', () => ({
  IngestionChart: () => <div data-testid="ingestion-chart" />,
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

import { AnalyticsDashboard } from '../analytics-dashboard'

const tags = (over: Partial<TagCounts> = {}): TagCounts => ({
  good: 0,
  bad: 0,
  questionable: 0,
  noReading: 0,
  notLive: 0,
  ...over,
})

const storage = {
  savedBytes: 3 * 1024 * 1024,
  activeDraftBytes: 1024,
  cleanupBytes: 2048,
  totalBytes: 3 * 1024 * 1024 + 3072,
}

const workspaceData: WorkspaceIntake = {
  scope: 'workspace',
  workspaceId: 'ws1',
  range: '24h',
  from: '2026-11-05T12:00:00.000Z',
  to: '2026-11-06T12:30:00.000Z',
  totals: {
    liveModels: 1,
    tags: tags({ good: 1, bad: 1 }),
    rowsIngested: 1200,
    badCellPct: 2.5,
    storage,
    datasetCount: 1,
  },
  ingestion: [],
  tags: [
    {
      modelId: 'm1',
      modelName: 'Model 1',
      tag: 'BAD.TAG',
      quality: 'bad',
      lastValue: 4.2,
      lastSeenAt: '2026-11-06T12:25:00.000Z',
      heldMinutes: 0,
    },
    {
      modelId: 'm1',
      modelName: 'Model 1',
      tag: 'GOOD.TAG',
      quality: 'good',
      lastValue: 1.1,
      lastSeenAt: '2026-11-06T12:25:00.000Z',
      heldMinutes: 5,
    },
  ],
  datasets: [
    {
      id: 'd1',
      name: 'Hot train',
      tagCount: 12,
      rowCount: 8760,
      missingPct: 1.5,
      sizeBytes: 3 * 1024 * 1024,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
}

const allData: AllWorkspacesIntake = {
  scope: 'all',
  range: '24h',
  from: workspaceData.from,
  to: workspaceData.to,
  totals: workspaceData.totals,
  ingestion: [],
  workspaces: [
    {
      id: 'ws1',
      name: 'Alpha Plant',
      liveModels: 1,
      tags: tags({ good: 4, bad: 1 }),
      rowsIngested: 1200,
      storageBytes: 5 * 1024 * 1024,
      datasetCount: 2,
    },
  ],
}

function ready(data: WorkspaceIntake | AllWorkspacesIntake) {
  intake.mockReturnValue({
    data,
    state: 'ready',
    isFetching: false,
    error: null,
    refetch,
  })
}

const ws = (id: string) => ({ id, name: `Workspace ${id}` })

beforeEach(() => {
  vi.clearAllMocks()
  session.mockReturnValue({ data: { user: { role: 'USER' } } })
  workspacesHook.mockReturnValue({ workspaces: [ws('ws1')], loading: false })
})

describe('AnalyticsDashboard', () => {
  it('shows a loading status, not empty figures, while the first load runs', () => {
    intake.mockReturnValue({
      data: null,
      state: 'loading',
      isFetching: true,
      error: null,
      refetch,
    })
    render(<AnalyticsDashboard workspaceId="ws1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading data intake')
    expect(screen.queryByText('Tags by model')).not.toBeInTheDocument()
  })

  it('shows one error with a retry, never an empty "all good" page', () => {
    intake.mockReturnValue({
      data: null,
      state: 'error',
      isFetching: false,
      error: "Couldn't load data intake.",
      refetch,
    })
    render(<AnalyticsDashboard workspaceId="ws1" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load data intake.",
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders a workspace: summary, live tags, dataset storage', () => {
    ready(workspaceData)
    render(<AnalyticsDashboard workspaceId="ws1" />)

    expect(screen.getByText('Live tags')).toBeInTheDocument()
    expect(screen.getByText('Tags by model')).toBeInTheDocument()
    expect(screen.getByText('BAD.TAG')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Dataset storage' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Hot train')).toBeInTheDocument()
    expect(screen.queryByText('Intake by workspace')).not.toBeInTheDocument()
    expect(intake).toHaveBeenCalledWith('ws1', '24h', true)
  })

  it('filters the tag table by quality', () => {
    ready(workspaceData)
    render(<AnalyticsDashboard workspaceId="ws1" />)

    fireEvent.click(screen.getByRole('button', { name: /^Bad/ }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('BAD.TAG')).toBeInTheDocument()
    expect(within(table).queryByText('GOOD.TAG')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Questionable/ }))
    expect(screen.getByText('No tags match this filter.')).toBeInTheDocument()
  })

  it('pages the tag table 15 at a time and returns to page 1 on a filter change', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      modelId: 'm1',
      modelName: 'Model 1',
      tag: `TAG.${String(i).padStart(2, '0')}`,
      quality: i === 19 ? ('bad' as const) : ('good' as const),
      lastValue: i,
      lastSeenAt: '2026-11-06T12:25:00.000Z',
      heldMinutes: 0,
    }))
    ready({ ...workspaceData, tags: many })
    render(<AnalyticsDashboard workspaceId="ws1" />)

    const bodyRows = () =>
      within(screen.getByRole('table')).getAllByRole('row').length - 1
    expect(bodyRows()).toBe(15)
    expect(screen.getByText('1–15 of 20')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(bodyRows()).toBe(5)
    expect(screen.getByText('16–20 of 20')).toBeInTheDocument()

    // Changing the filter must not leave the viewer on page 2 of a shorter list.
    fireEvent.click(screen.getByRole('button', { name: /^Bad/ }))
    expect(bodyRows()).toBe(1)
    expect(
      screen.queryByRole('navigation', { name: 'Tags pagination' }),
    ).not.toBeInTheDocument()
  })

  it('renders the all-workspaces table with a link into each workspace', () => {
    session.mockReturnValue({ data: { user: { role: 'ADMIN' } } })
    workspacesHook.mockReturnValue({
      workspaces: [ws('ws1'), ws('ws2')],
      loading: false,
    })
    ready(allData)
    render(<AnalyticsDashboard workspaceId="all" />)

    expect(screen.getByText('Intake by workspace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alpha Plant' })).toHaveAttribute(
      'href',
      '/analytics/ws1',
    )
    expect(screen.queryByText('Tags by model')).not.toBeInTheDocument()
  })

  it('offers the workspace picker to an admin only', () => {
    ready(workspaceData)
    const { unmount } = render(<AnalyticsDashboard workspaceId="ws1" />)
    expect(
      screen.queryByRole('combobox', { name: 'Workspace' }),
    ).not.toBeInTheDocument()
    unmount()

    session.mockReturnValue({ data: { user: { role: 'ADMIN' } } })
    render(<AnalyticsDashboard workspaceId="ws1" />)
    expect(
      screen.getByRole('combobox', { name: 'Workspace' }),
    ).toBeInTheDocument()
  })

  it('shows no-access, and does not fetch, for a workspace the viewer is not in', () => {
    intake.mockReturnValue({
      data: null,
      state: 'loading',
      isFetching: false,
      error: null,
      refetch,
    })
    render(<AnalyticsDashboard workspaceId="not-mine" />)

    expect(
      screen.getByText('Workspace not found or you do not have access.'),
    ).toBeInTheDocument()
    expect(intake).toHaveBeenCalledWith('not-mine', '24h', false)
  })

  it('dims the previous figures while a new range loads', () => {
    intake.mockReturnValue({
      data: workspaceData,
      state: 'ready',
      isFetching: true,
      error: null,
      refetch,
    })
    const { container } = render(<AnalyticsDashboard workspaceId="ws1" />)
    expect(container.querySelector('[aria-busy="true"]')).toHaveClass(
      'opacity-60',
    )
  })
})
