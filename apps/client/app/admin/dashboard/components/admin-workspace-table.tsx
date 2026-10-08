'use client'

import { useId } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Activity, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CountValue,
  StatusPill,
  WorkspaceIconTile,
} from '@/components/workspace/workspace-parts'
import { WorkspacePagination } from '@/components/workspace/workspace-pagination'
import {
  equipmentDetail,
  needsAttention,
  ownerName,
} from '@/lib/admin-dashboard'
import type { WorkspacePage } from '@/lib/workspace-list'
import type { AdminWorkspace } from '@/types'
import { cn } from '@/lib/utils'
import type { LoadState } from './attention-queue'

const ROW_GRID =
  'grid items-center gap-x-4 md:grid-cols-[minmax(0,2fr)_9rem_3.5rem_3.5rem_4rem_6rem_1.25rem]'

function Row({ ws }: { ws: AdminWorkspace }) {
  const detail = equipmentDetail(ws)
  return (
    <li
      className={cn(
        ROW_GRID,
        'relative border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <WorkspaceIconTile iconId={ws.icon} colorId={ws.color} />
        <div className="min-w-0">
          <Link
            href={`/admin/workspaces/${ws.id}/settings`}
            title={ws.name}
            className="block truncate rounded-sm text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ws.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            Owner: {ownerName(ws.owner)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-col items-start gap-0.5 md:mt-0">
        {/* The column header is aria-hidden and gone on phones: say what this
            is. Visible below md, screen-reader-only from md up. */}
        <span className="text-xs text-muted-foreground md:sr-only">
          Equipment status
        </span>
        {ws.status === undefined ? (
          <span className="text-sm text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">unknown</span>
          </span>
        ) : ws.nodeCount === 0 ? (
          // Nothing to monitor: a green "Normal" would claim a check that
          // never happened.
          <span className="text-sm text-muted-foreground">No equipment</span>
        ) : (
          <StatusPill status={needsAttention(ws) ? 'abnormal' : 'normal'} />
        )}
        {detail && (
          <span className="text-xs text-muted-foreground">{detail}</span>
        )}
      </div>
      <span className="hidden md:block">
        <CountValue value={ws.modelsCount} label="models" />
      </span>
      <span className="hidden md:block">
        <CountValue value={ws.plantsCount} label="plants" />
      </span>
      <span className="hidden md:block">
        <CountValue value={ws.datasetsCount} label="datasets" />
      </span>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground md:block">
        <span className="sr-only">Updated </span>
        <time dateTime={ws.updatedAt}>
          {formatDistanceToNow(new Date(ws.updatedAt), { addSuffix: true })}
        </time>
      </span>
      <ChevronRight
        className="hidden size-4 text-muted-foreground md:block"
        aria-hidden
      />
    </li>
  )
}

function RowSkeleton() {
  return (
    <li
      className={cn(
        ROW_GRID,
        'border-b border-border px-4 py-3 last:border-b-0',
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="hidden h-4 w-6 md:block" />
      <Skeleton className="hidden h-4 w-6 md:block" />
      <Skeleton className="hidden h-4 w-6 md:block" />
      <Skeleton className="hidden h-3 w-16 md:block" />
      <span />
    </li>
  )
}

/**
 * The platform's workspaces, one dense row each, with server-side search and
 * pagination. Status is EQUIPMENT status (the column says so). Loading,
 * error, empty and no-match are one branch, so none renders beside the list.
 */
export function AdminWorkspaceTable({
  state,
  items,
  page,
  search,
  searching,
  fetching = false,
  onSearch,
  onPage,
  onRetry,
}: {
  state: LoadState
  items: AdminWorkspace[]
  page: WorkspacePage<unknown>
  /** What is typed in the box. */
  search: string
  /** Whether the rows on screen were fetched WITH a search term (the
   *  debounced one) — not what is typed right now, which may already be
   *  cleared while the old, empty result is still showing. */
  searching: boolean
  /** A page / search request is in flight; the old rows stay, dimmed. */
  fetching?: boolean
  onSearch: (v: string) => void
  onPage: (p: number) => void
  onRetry: () => void
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state === 'loading' || fetching}
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={headingId} className="text-base font-medium">
          Workspaces
        </h2>
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {state === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            Loading workspaces
          </p>
          <ul
            role="list"
            aria-hidden
            className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </ul>
        </>
      ) : state === 'error' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-foreground/10"
        >
          <span className="text-muted-foreground">
            Couldn&apos;t load workspaces.
          </span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 && page.total > 0 ? (
        // The server does not pull an out-of-range page back (e.g. after a
        // delete): the platform HAS workspaces, so never say it has none.
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 py-8 text-sm text-muted-foreground"
        >
          This page is empty.
          <Button variant="outline" size="sm" onClick={() => onPage(1)}>
            Back to the first page
          </Button>
        </div>
      ) : items.length === 0 ? (
        searching ? (
          <p
            role="status"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            No workspace matches your search. Clear it to see them all.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Activity className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-base font-medium">No workspaces yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Workspaces appear here as soon as someone creates one.
            </p>
          </div>
        )
      ) : (
        <>
          <div
            className={cn(
              'overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-opacity',
              fetching && 'opacity-60',
            )}
          >
            <div
              aria-hidden
              className={cn(
                ROW_GRID,
                'hidden border-b border-border px-4 py-2 text-xs text-muted-foreground md:grid',
              )}
            >
              <span>Workspace</span>
              <span>Equipment status</span>
              <span>Models</span>
              <span>Plants</span>
              <span>Datasets</span>
              <span>Updated</span>
              <span />
            </div>
            <ul role="list">
              {items.map(ws => (
                <Row key={ws.id} ws={ws} />
              ))}
            </ul>
          </div>
          <WorkspacePagination
            page={page}
            onPage={onPage}
            label="Admin workspaces pagination"
          />
        </>
      )}
    </section>
  )
}
