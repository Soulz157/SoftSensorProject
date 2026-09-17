'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BrainCircuit,
  Clock,
  Database,
  Factory,
  BarChart3,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import { cn } from '@/lib/utils'
import { toBinaryStatus, BINARY_STATUS_META } from '@/lib/overview-status'
import type { Workspace } from '@/types'
import type { NodeStatus } from '@/store/status-colors'

function WorkspaceIcon({
  iconId,
  colorId,
}: {
  iconId: string
  colorId: string
}) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon
  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white text-lg font-semibold shadow-sm ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-6 w-6" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

/**
 * A count the list payload does not carry is UNKNOWN, not zero. Rendering 0
 * for an absent count makes a real zero and a not-yet-supplied count identical
 * on screen — the conflation DS-LAKE-021, DS-LAKE-025-T06 and MODEL-SERVE-005
 * each refused. An em-dash says "not known" honestly.
 */
function CountStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BrainCircuit
  label: string
  value: number | null | undefined
}) {
  const known = typeof value === 'number'
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums',
          known ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-label={known ? `${value} ${label}` : `${label} unknown`}
      >
        {known ? value : '—'}
      </span>
    </div>
  )
}

/**
 * The list endpoint always supplies `status` (`deriveNodeSummary` returns it
 * unconditionally), so this card requires it rather than defaulting an absent
 * value to `normal` — a green badge is a claim, and an unverified one is the
 * silent fall-through MODEL-SERVE-001-T22 cost three fixes.
 */
export type WorkspaceCardData = Workspace & { status: NodeStatus }

export function WorkspaceCard({ workspace }: { workspace: WorkspaceCardData }) {
  const selectedColor = workspaceColors.find(
    item => item.id === workspace.color,
  )
  const accentClass = selectedColor?.bg || 'bg-blue-500'

  // Operating state rides the list payload — `deriveNodeSummary` computes it
  // server-side from the nodes join already in the query, so the card costs no
  // request of its own. Collapsed to binary per lib/overview-status.ts, which
  // names Workspace explicitly, so this card cannot disagree with the
  // analytics table or the admin list about the same workspace.
  const wsBinary = toBinaryStatus(workspace.status)
  const wsMeta = BINARY_STATUS_META[wsBinary]

  return (
    <Card className="group relative flex flex-col overflow-hidden border-border transition-all hover:border-primary/50">
      <div className={cn('absolute left-0 top-0 h-1 w-full', accentClass)} />

      <CardContent className="flex flex-1 flex-col p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <WorkspaceIcon
            iconId={workspace.icon || 'box'}
            colorId={workspace.color || 'slate'}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">
                {/* Stretched link: the whole card navigates, without nesting
                    an anchor around the footer's own buttons. */}
                <Link
                  href={`/plants/${workspace.id}`}
                  className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {workspace.name}
                </Link>
              </h3>
              <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-medium border border-border">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    wsMeta.dot,
                    wsBinary === 'abnormal' &&
                      'ring-4 ring-red-500/20 motion-safe:animate-pulse',
                  )}
                />
                {wsMeta.label}
              </span>
            </div>
            {workspace.description && (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {workspace.description}
              </p>
            )}
          </div>
        </div>

        {/* Counts — all three ride the list payload, no per-card fetch */}
        <div className="mb-6 grid grid-cols-3 gap-4 border-y border-border/50 py-4">
          <CountStat
            icon={BrainCircuit}
            label="Models"
            value={workspace.modelsCount}
          />
          <CountStat
            icon={Factory}
            label="Plants"
            value={workspace.plantsCount}
          />
          <CountStat
            icon={Database}
            label="Datasets"
            value={workspace.datasetsCount}
          />
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Updated{' '}
            {formatDistanceToNow(new Date(workspace.updatedAt), {
              addSuffix: true,
            })}
          </span>
          <div className="relative z-10 flex items-center gap-2">
            <Link href={`/workspaces/${workspace.id}/settings`}>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Settings
              </Button>
            </Link>
            <Link href="/models/views">
              <Button
                size="sm"
                className="cursor-pointer h-8 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Models
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkspaceCardSkeleton() {
  return (
    <Card className="border-border">
      <CardContent className="flex flex-col p-6">
        <div className="mb-6 flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="mb-6 grid grid-cols-3 gap-4 border-y border-border/50 py-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
