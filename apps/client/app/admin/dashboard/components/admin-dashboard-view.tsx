import { adminSummarySegments } from '@/lib/admin-dashboard'
import type { WorkspacePage } from '@/lib/workspace-list'
import type {
  ActivityLog,
  AdminWorkspace,
  AdminWorkspaceSummary,
} from '@/types'
import { AdminSummaryHeader } from './admin-summary-header'
import { AdminWorkspaceTable } from './admin-workspace-table'
import { AttentionQueue, type LoadState } from './attention-queue'
import { RecentActivity } from './recent-activity'

/** `ops`: table left, attention + activity in a narrow right column.
 *  `console`: one column — attention strip, table, then activity. */
export type AdminLayout = 'ops' | 'console'

export interface AdminDashboardViewProps {
  layout: AdminLayout
  summary: {
    state: LoadState
    data: AdminWorkspaceSummary | null
    onRetry: () => void
  }
  /** Total users, or null while unknown. */
  users: number | null
  table: {
    state: LoadState
    items: AdminWorkspace[]
    page: WorkspacePage<unknown>
    search: string
    searching: boolean
    fetching?: boolean
    onSearch: (v: string) => void
    onPage: (p: number) => void
    onRetry: () => void
  }
  activity: {
    state: LoadState
    items: ActivityLog[]
    onRetry: () => void
  }
  onCreate: () => void
}

/**
 * The admin dashboard, presentational: every figure arrives as a prop (real
 * hooks in the page, mock data in the design preview). A summary that has
 * not loaded shows "—", never a guessed total.
 */
export function AdminDashboardView({
  layout,
  summary,
  users,
  table,
  activity,
  onCreate,
}: AdminDashboardViewProps) {
  const ready = summary.state === 'ready' && summary.data !== null
  const segments = adminSummarySegments({
    total: ready ? summary.data!.total : null,
    attention: ready ? summary.data!.attentionTotal : null,
    models: ready ? summary.data!.models : null,
    users,
  })

  const attention = (
    <AttentionQueue
      state={summary.state}
      items={summary.data?.attention ?? []}
      total={summary.data?.attentionTotal ?? 0}
      onRetry={summary.onRetry}
    />
  )
  const list = <AdminWorkspaceTable {...table} />
  const recent = (
    <RecentActivity
      state={activity.state}
      items={activity.items}
      onRetry={activity.onRetry}
    />
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminSummaryHeader segments={segments} onCreate={onCreate} />
      {layout === 'ops' ? (
        // DOM order is the reading and Tab order everywhere: attention,
        // table, activity. From lg the columns are placed with the grid (not
        // CSS `order`), so what is seen and what is announced never differ.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:items-start">
          <div className="lg:col-start-2 lg:row-start-1">{attention}</div>
          <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {list}
          </div>
          <div className="lg:col-start-2 lg:row-start-2">{recent}</div>
        </div>
      ) : (
        <>
          {/* The strip appears only when there is something to act on (or
              while loading / failed, so a failure is never silent). */}
          {(summary.state !== 'ready' ||
            (summary.data?.attentionTotal ?? 0) > 0) &&
            attention}
          {list}
          {recent}
        </>
      )}
    </div>
  )
}
