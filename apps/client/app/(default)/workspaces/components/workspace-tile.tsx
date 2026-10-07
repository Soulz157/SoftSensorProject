import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { workspaceStatus, type WorkspaceListItem } from '@/lib/workspace-list'
import {
  AttentionNote,
  CountValue,
  StatusPill,
  WorkspaceIconTile,
} from './workspace-parts'

function Stat({
  label,
  value,
}: {
  label: string
  value: number | null | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <CountValue value={value} label={label.toLowerCase()} />
    </div>
  )
}

/** Direction B: the card, quieter. Flat, status beside the name, the one
 *  attention callout, and a ring (not a shadow or lift) on hover. */
export function WorkspaceTile({ ws }: { ws: WorkspaceListItem }) {
  const status = workspaceStatus(ws)
  return (
    <li className="relative flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:ring-primary/40 has-[a:focus-visible]:ring-primary/40">
      <div className="flex items-start gap-3">
        <WorkspaceIconTile iconId={ws.icon} colorId={ws.color} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium" title={ws.name}>
            <Link
              href={`/plants/${ws.id}`}
              className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {ws.name}
            </Link>
          </h3>
          {ws.description && (
            <p className="truncate text-sm text-muted-foreground">
              {ws.description}
            </p>
          )}
        </div>
        <StatusPill status={status} />
      </div>
      <div className="grid grid-cols-3 gap-4 border-y border-border py-3">
        <Stat label="Models" value={ws.modelsCount} />
        <Stat label="Plants" value={ws.plantsCount} />
        <Stat label="Datasets" value={ws.datasetsCount} />
      </div>
      <AttentionNote count={ws.abnormalModels} />
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Updated{' '}
          {formatDistanceToNow(new Date(ws.updatedAt), { addSuffix: true })}
        </span>
        <div className="relative z-10 flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            aria-label={`${ws.name} settings`}
          >
            <Link href={`/workspaces/${ws.id}/settings`}>Settings</Link>
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
      </div>
    </li>
  )
}

export function WorkspaceTileSkeleton() {
  return (
    <li className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-4 border-y border-border py-3">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-32" />
      </div>
    </li>
  )
}
