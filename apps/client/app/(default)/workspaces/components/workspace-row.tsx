import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { workspaceStatus, type WorkspaceListItem } from '@/lib/workspace-list'
import {
  AttentionNote,
  CountValue,
  StatusPill,
  WorkspaceIconTile,
} from './workspace-parts'

/** Column template shared by the header, rows and skeletons. */
export const ROW_GRID =
  'grid items-center gap-x-4 md:grid-cols-[minmax(0,2.2fr)_7rem_minmax(0,1.3fr)_4rem_5rem_8rem_9rem]'

/** Direction A: one dense row. The whole row links to the workspace; the
 *  actions sit above the stretched link. */
export function WorkspaceRow({ ws }: { ws: WorkspaceListItem }) {
  const status = workspaceStatus(ws)
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
            href={`/plants/${ws.id}`}
            title={ws.name}
            className="block truncate rounded-sm text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ws.name}
          </Link>
          {ws.description && (
            <p className="truncate text-xs text-muted-foreground">
              {ws.description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 md:mt-0">
        <StatusPill status={status} />
      </div>
      <div className="mt-1 flex flex-col gap-0.5 md:mt-0">
        <span className="flex items-baseline gap-1.5">
          <CountValue value={ws.modelsCount} label="models" />
          <span className="text-xs text-muted-foreground">models</span>
        </span>
        <AttentionNote count={ws.abnormalModels} />
      </div>
      <span className="hidden md:block">
        <CountValue value={ws.plantsCount} label="plants" />
      </span>
      <span className="hidden md:block">
        <CountValue value={ws.datasetsCount} label="datasets" />
      </span>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground md:block">
        {/* The column header is aria-hidden; say what this time is. */}
        <span className="sr-only">Updated </span>
        {formatDistanceToNow(new Date(ws.updatedAt), { addSuffix: true })}
      </span>
      <div className="relative z-10 mt-2 flex items-center gap-1 md:mt-0">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label={`${ws.name} settings`}
        >
          <Link href={`/workspaces/${ws.id}/settings`}>
            <Settings />
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          aria-label={`${ws.name} models`}
        >
          <Link href={`/models/views?workspace=${encodeURIComponent(ws.id)}`}>
            Models
          </Link>
        </Button>
      </div>
    </li>
  )
}

export function WorkspaceRowHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        ROW_GRID,
        'hidden border-b border-border px-4 py-2 text-xs text-muted-foreground md:grid',
      )}
    >
      <span>Workspace</span>
      <span>Status</span>
      <span>Models</span>
      <span>Plants</span>
      <span>Datasets</span>
      <span>Updated</span>
      <span />
    </div>
  )
}

export function WorkspaceRowSkeleton() {
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
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="hidden h-4 w-6 md:block" />
      <Skeleton className="hidden h-4 w-6 md:block" />
      <Skeleton className="hidden h-3 w-20 md:block" />
      <Skeleton className="h-8 w-28" />
    </li>
  )
}
