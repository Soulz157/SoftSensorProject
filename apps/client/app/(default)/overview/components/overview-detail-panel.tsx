'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Building2,
  X,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { workspaceIcons } from '@/store/workspace'
import { useModels } from '@/hooks/workspace/use-models'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'
import {
  DEPLOY_DOT,
  DEPLOY_PRIORITY,
  NODE_BADGE,
  NODE_DOT,
  NODE_STATUS_PRIORITY,
  PROD_BADGE,
} from '@/constants/status'

interface OverviewDetailPanelProps {
  workspace: Workspace | null
  nodes: CanvasNode[]
  onClose: () => void
  onViewWorkspace: (id: string) => void
  onOpenPipeEditor: (id: string) => void
  onViewAlerts: () => void
}

function StatCell({
  label,
  value,
  valueClass,
}: {
  label: string
  value: number
  valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-3">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn('text-xl font-semibold', valueClass ?? 'text-foreground')}
      >
        {value}
      </p>
    </div>
  )
}

const MAX_PREVIEW = 5

function PanelContent({
  workspace,
  nodes,
  onClose,
  onViewWorkspace,
  onOpenPipeEditor,
  onViewAlerts,
}: OverviewDetailPanelProps & { workspace: Workspace }) {
  const { data: modelsRaw, isFetching: modelsFetching } = useModels(
    workspace.id,
  )
  const models = modelsRaw ?? []
  const modelsLoading = modelsFetching && modelsRaw === null

  const nodeCount = nodes.length
  const alarmCount = nodes.filter(n => n.data.status === 'alarm').length
  const warningCount = nodes.filter(n => n.data.status === 'warning').length
  const offlineCount = nodes.filter(n => n.data.status === 'offline').length

  const worstStatus: 'alarm' | 'warning' | 'offline' | 'normal' =
    alarmCount > 0
      ? 'alarm'
      : offlineCount > 0
        ? 'offline'
        : warningCount > 0
          ? 'warning'
          : 'normal'

  const IconComponent =
    workspaceIcons.find(i => i.id === workspace.icon)?.icon ?? Building2

  const statusBadgeClass = {
    alarm: 'border-destructive/40 bg-destructive/10 text-destructive',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
    offline: 'border-border bg-muted text-muted-foreground',
    normal: 'border-green-500/40 bg-green-500/10 text-green-500',
  }[worstStatus]

  const statusBadgeText = {
    alarm: `Alarm — ${alarmCount} equipment${alarmCount === 1 ? '' : 's'} critical`,
    warning: `Warning — ${warningCount} equipment${warningCount === 1 ? '' : 's'} affected`,
    offline: 'Offline',
    normal: 'All Systems Normal',
  }[worstStatus]

  const sortedNodes = [...nodes].sort(
    (a, b) =>
      (NODE_STATUS_PRIORITY[a.data.status] ?? 3) -
      (NODE_STATUS_PRIORITY[b.data.status] ?? 3),
  )
  const previewNodes = sortedNodes.slice(0, MAX_PREVIEW)
  const hasMoreNodes = nodes.length > MAX_PREVIEW

  const sortedModels = [...models].sort(
    (a, b) =>
      (DEPLOY_PRIORITY[a.data?.deployStatus ?? 'stopped'] ?? 4) -
      (DEPLOY_PRIORITY[b.data?.deployStatus ?? 'stopped'] ?? 4),
  )
  const previewModels = sortedModels.slice(0, MAX_PREVIEW)
  const hasMoreModels = models.length > MAX_PREVIEW

  return (
    <div className="flex h-full w-full flex-col border-t border-border bg-card/90 backdrop-blur-xl sm:w-75 sm:shrink-0 sm:border-l sm:border-t-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <IconComponent className="h-4.5 w-4.5 text-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {workspace.name}
              </p>
              {workspace.description && (
                <p className="truncate text-xs text-muted-foreground">
                  {workspace.description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close panel"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="min-h-0 flex-1">
        <div>
          {/* Status badge */}
          <div className="border-b border-border/50 px-4 py-3">
            <div
              className={cn(
                'flex w-full items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold',
                statusBadgeClass,
              )}
            >
              {worstStatus === 'alarm' && (
                <AlertCircle
                  aria-hidden="true"
                  className="mr-1.5 h-3.5 w-3.5"
                />
              )}
              {worstStatus === 'warning' && (
                <AlertTriangle
                  aria-hidden="true"
                  className="mr-1.5 h-3.5 w-3.5"
                />
              )}
              {statusBadgeText}
            </div>
          </div>

          {/* Stats grid 2×2 */}
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 text-xs font-medium text-muted-foreground">
              Summary
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCell
                label="Equipments"
                value={nodeCount}
                valueClass="text-primary"
              />
              <StatCell
                label="Models"
                value={workspace._count.models}
                valueClass="text-primary"
              />
              <StatCell
                label="Alarms"
                value={alarmCount}
                valueClass={
                  alarmCount > 0 ? 'text-destructive' : 'text-green-500'
                }
              />
              <StatCell
                label="Warnings"
                value={warningCount}
                valueClass={
                  warningCount > 0 ? 'text-amber-500' : 'text-muted-foreground'
                }
              />
            </div>
          </div>

          {/* Equipment Overview */}
          {nodeCount > 0 && (
            <div className="border-b border-border/50 px-4 py-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Equipment ({nodeCount})
                </span>
              </div>
              <div className="space-y-0.5">
                {previewNodes.map(node => {
                  const st = node.data.status ?? 'normal'
                  return (
                    <Link
                      key={node.id}
                      href={`/workspaces/${workspace.id}/canvas`}
                      className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          NODE_DOT[st] ?? 'bg-zinc-400',
                          st === 'alarm' &&
                            'ring-4 ring-destructive/20 motion-safe:animate-pulse',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {node.data.name}
                        </p>
                        <p className="text-[10px] capitalize text-muted-foreground">
                          {node.data.type}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-[10px] font-semibold capitalize',
                          NODE_BADGE[st] ?? 'text-muted-foreground',
                        )}
                      >
                        {st}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </Link>
                  )
                })}
              </div>
              {hasMoreNodes && (
                <Link
                  href={`/workspaces/${workspace.id}/canvas`}
                  className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  View all {nodeCount} equipment
                  <ArrowRight aria-hidden="true" className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}

          {/* Models Overview */}
          <div className="px-4 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Models ({models.length})
              </span>
            </div>
            {modelsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : models.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No models deployed
              </p>
            ) : (
              <>
                <div className="space-y-0.5">
                  {previewModels.map(model => {
                    const deploy = model.data?.deployStatus ?? 'stopped'
                    const prod = model.data?.prodStatus ?? 'offline'
                    return (
                      <Link
                        key={model.id}
                        href={`/models/${model.id}`}
                        className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                      >
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            DEPLOY_DOT[deploy] ?? 'bg-zinc-400',
                            deploy === 'error' &&
                              'ring-4 ring-red-500/20 motion-safe:animate-pulse',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {model.name}
                          </p>
                          <p className="text-[10px] capitalize text-muted-foreground">
                            {deploy}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-[10px] font-semibold capitalize',
                            PROD_BADGE[prod] ?? 'text-muted-foreground',
                          )}
                        >
                          {prod}
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </Link>
                    )
                  })}
                </div>
                {hasMoreModels && (
                  <Link
                    href={`/models?workspaceId=${workspace.id}`}
                    className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    View all {models.length} models
                    <ArrowRight aria-hidden="true" className="h-3 w-3" />
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Sticky actions footer */}
      <div className="shrink-0 space-y-2 border-t border-border bg-card/80 px-4 py-4">
        {alarmCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-2"
            onClick={onViewAlerts}
          >
            View All Alerts
            <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className="w-full gap-2"
          onClick={() => onViewWorkspace(workspace.id)}
        >
          View Workspace
          <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => onOpenPipeEditor(workspace.id)}
        >
          Open Pipeline Editor
          <ArrowRight className="h-3 w-3 shrink-0" />
        </Button>
      </div>
    </div>
  )
}

export function OverviewDetailPanel(props: OverviewDetailPanelProps) {
  if (!props.workspace) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 border-t border-border bg-card/90 p-6 text-center backdrop-blur-xl sm:w-75 sm:shrink-0 sm:border-l sm:border-t-0">
        <Building2 className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">
          Select a plant to view details
        </p>
      </div>
    )
  }

  return <PanelContent {...props} workspace={props.workspace} />
}
