'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Activity } from 'lucide-react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAllModels } from '@/hooks/use-all-models'
import { abnormalModelCountByWorkspace } from '@/lib/model-status'
import {
  filterWorkspaces,
  noMatchMessage,
  paginate,
  sortForAttention,
  summarizeWorkspaces,
  toWorkspaceListItems,
  type StatusFilter,
} from '@/lib/workspace-list'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import { WorkspacesHeader } from './components/workspaces-header'
import { WorkspacesToolbar } from './components/workspaces-toolbar'
import { WorkspacesPagination } from './components/workspaces-pagination'
import {
  WorkspaceRow,
  WorkspaceRowHeader,
  WorkspaceRowSkeleton,
} from './components/workspace-row'

export default function WorkspacesPage() {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  // MODEL-SERVE-024-D02: a workspace is Abnormal for an alerting node OR an
  // abnormal model (failed deploy / monitoring ALERT) — the same rule the
  // sidebar and Overview apply. Until the model list has loaded the abnormal
  // count is UNKNOWN (null), never 0: rows read "Checking", the summary and
  // filter counts read "—", and nothing claims "0 need attention".
  const { models, error: modelsError, refetch: refetchModels } = useAllModels()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const topRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      toWorkspaceListItems(
        workspaces,
        models ? abnormalModelCountByWorkspace(models) : null,
      ),
    [workspaces, models],
  )
  const summary = useMemo(() => summarizeWorkspaces(items), [items])
  const visible = useMemo(
    () => sortForAttention(filterWorkspaces(items, { query, status })),
    [items, query, status],
  )
  const current = paginate(visible, page)
  // Keep the stored page in range (the list can shrink under it), so a list
  // that later grows again doesn't jump back to a page the user left.
  if (current.page !== page) setPage(current.page)

  // A new search or filter starts again from page 1.
  const changeQuery = (v: string) => {
    setQuery(v)
    setPage(1)
  }
  const changeStatus = (v: StatusFilter) => {
    setStatus(v)
    setPage(1)
  }
  // The pager sits under the list; bring the new page's first row into view.
  const changePage = (p: number) => {
    setPage(p)
    topRef.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Workspaces</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <WorkspacesHeader summary={summary} onCreate={() => setIsOpen(true)} />
        <CreateWorkspaceDialog open={isOpen} onClose={() => setIsOpen(false)} />

        {modelsError && models === null && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-foreground/10"
          >
            <span className="text-muted-foreground">
              Couldn&apos;t load model status, so which workspaces need
              attention is unknown.
            </span>
            <Button variant="outline" size="sm" onClick={refetchModels}>
              Try again
            </Button>
          </div>
        )}

        <div ref={topRef} className="scroll-mt-6">
          <WorkspacesToolbar
            query={query}
            onQuery={changeQuery}
            status={status}
            onStatus={changeStatus}
            counts={{
              all: summary.total,
              attention: summary.attention,
              normal: summary.normal,
            }}
          />
        </div>

        {/* Loading / empty / no-match / populated are ONE branch, so the
            empty state replaces the list instead of rendering beneath it. */}
        {workspacesLoading ? (
          <ul
            role="list"
            aria-busy
            className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <WorkspaceRowSkeleton key={i} />
            ))}
          </ul>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Activity className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-base font-medium">No workspaces yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create your first workspace to get started.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p
            role="status"
            className="py-16 text-center text-sm text-muted-foreground"
          >
            {noMatchMessage(query, status)}
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <WorkspaceRowHeader />
              <ul role="list">
                {current.items.map(ws => (
                  <WorkspaceRow key={ws.id} ws={ws} />
                ))}
              </ul>
            </div>
            <WorkspacesPagination page={current} onPage={changePage} />
          </>
        )}
      </div>
    </div>
  )
}
