'use client'

import { useState } from 'react'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import { useAdminWorkspaces } from '@/hooks/admin/use-admin-workspaces'
import { useAdminWorkspaceSummary } from '@/hooks/admin/use-admin-workspace-summary'
import { useActivityLog, useUserStats } from '@/hooks/admin/use-activity'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ADMIN_PAGE_SIZE, pageFromServer } from '@/lib/admin-dashboard'
import { AdminDashboardView } from './admin-dashboard-view'
import type { LoadState } from './attention-queue'

/**
 * The real admin dashboard: wires the hooks to the presentational view.
 * Every section maps its own hook to a LoadState with the ERROR winning, so a
 * failed (or failed-refetch) section is never shown as empty or healthy.
 */
export function AdminDashboard() {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  // The term the list is fetched with: trimmed (a lone space must not become
  // a `contains: " "` filter that matches nothing).
  const term = debouncedSearch.trim()
  // The page belongs to the term it was chosen under: when the term changes
  // the page falls back to 1 in the SAME render — no extra request for the
  // old term's page 1, and no old page-N rows under a "Page 1" label.
  const [pageState, setPageState] = useState({ term: '', page: 1 })
  const page = pageState.term === term ? pageState.page : 1
  const setPage = (p: number) => setPageState({ term, page: p })

  const summary = useAdminWorkspaceSummary()
  const workspaces = useAdminWorkspaces({
    page,
    limit: ADMIN_PAGE_SIZE,
    search: term || undefined,
  })
  const users = useUserStats({ page: 1, limit: 1 })
  const activity = useActivityLog({ page: 1, limit: 8 })

  const stateOf = (error: string | null, loaded: boolean): LoadState =>
    error ? 'error' : loaded ? 'ready' : 'loading'

  const refreshAll = () => {
    summary.refetch()
    void workspaces.refetch()
  }

  return (
    <div className="flex-1 overflow-auto p-6 md:p-8">
      <AdminDashboardView
        layout="ops"
        summary={{
          state: stateOf(summary.error, summary.data !== null),
          data: summary.data,
          onRetry: summary.refetch,
        }}
        users={users.data?.total ?? null}
        table={{
          state: stateOf(workspaces.error, workspaces.data !== null),
          items: workspaces.data?.items ?? [],
          page: pageFromServer(workspaces.data),
          search,
          searching: term !== '',
          fetching: workspaces.isFetching,
          onSearch: setSearch,
          onPage: setPage,
          onRetry: () => void workspaces.refetch(),
        }}
        activity={{
          state: stateOf(activity.error, activity.data !== null),
          items: activity.data?.items ?? [],
          onRetry: () => void activity.refetch(),
        }}
        onCreate={() => setIsOpen(true)}
      />
      <CreateWorkspaceDialog
        open={isOpen}
        onClose={() => {
          setIsOpen(false)
          // A workspace may have been created: refresh what depends on it.
          refreshAll()
        }}
      />
    </div>
  )
}
