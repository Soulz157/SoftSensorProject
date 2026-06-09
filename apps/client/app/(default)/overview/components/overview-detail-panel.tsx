'use client'

import { Building2, X, AlertTriangle, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { workspaceIcons } from '@/store/workspace'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

interface OverviewDetailPanelProps {
  workspace: Workspace | null
  nodes: CanvasNode[]
  onClose: () => void
  onViewWorkspace: (id: string) => void
  onOpenCanvas: (id: string) => void
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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn('text-xl font-bold', valueClass ?? 'text-foreground')}>
        {value}
      </p>
    </div>
  )
}

export function OverviewDetailPanel({
  workspace,
  nodes,
  onClose,
  onViewWorkspace,
  onOpenCanvas,
  onViewAlerts,
}: OverviewDetailPanelProps) {
  if (!workspace) {
    return (
      <div className="flex h-full w-75 shrink-0 flex-col items-center justify-center gap-3 border-l border-border bg-card/90 p-6 text-center backdrop-blur-xl">
        <Building2 className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">
          Select a plant to view details
        </p>
      </div>
    )
  }

  const nodeCount = nodes.length
  const alarmCount = nodes.filter(n => n.data.status === 'alarm').length
  const warningCount = nodes.filter(n => n.data.status === 'warning').length
  const offlineCount = nodes.filter(n => n.data.status === 'offline').length

  const alarmNodes = nodes.filter(n => n.data.status === 'alarm')
  const warningNodes = nodes.filter(n => n.data.status === 'warning')

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

  return (
    <div className="flex h-full w-75 shrink-0 flex-col border-l border-border bg-card/90 backdrop-blur-xl">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <IconComponent className="h-4.5 w-4.5 text-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">
                {workspace.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Sub-company workspace
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="space-y-0">
          {/* Status badge */}
          <div className="border-b border-border/50 px-4 py-3">
            <div
              className={cn(
                'flex w-full items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold',
                statusBadgeClass,
              )}
            >
              {worstStatus === 'alarm' && (
                <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              {worstStatus === 'warning' && (
                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              )}
              {statusBadgeText}
            </div>
          </div>

          {/* Stats grid 2×2 */}
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCell
                label="Equipments"
                value={nodeCount}
                valueClass="text-blue-500"
              />
              <StatCell
                label="Models"
                value={workspace.modelsCount}
                valueClass="text-blue-500"
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

          {/* Alarm list */}
          {alarmCount > 0 && (
            <div className="border-b border-border/50 px-4 py-4">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                Alarms ({alarmCount})
              </div>
              <div className="space-y-2">
                {alarmNodes.map(node => (
                  <div
                    key={node.id}
                    className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {node.data.name}
                          </p>
                          <p className="text-[10px] capitalize text-muted-foreground">
                            {node.data.type}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold text-destructive">
                        Status: alarm
                      </span>
                    </div>
                    <p className="mt-1 pl-4 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(node.updatedAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning list */}
          {warningCount > 0 && (
            <div className="border-b border-border/50 px-4 py-4">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                Warnings ({warningCount})
              </div>
              <div className="space-y-2">
                {warningNodes.map(node => (
                  <div
                    key={node.id}
                    className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {node.data.name}
                          </p>
                          <p className="text-[10px] capitalize text-muted-foreground">
                            {node.data.type}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold text-amber-500">
                        Status: warning
                      </span>
                    </div>
                    <p className="mt-1 pl-4 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(node.updatedAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Sticky actions footer */}
      <div className="shrink-0 space-y-2 border-t border-border bg-card/80 px-4 py-4">
        {alarmCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={onViewAlerts}
          >
            View All Alerts →
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className="w-full"
          onClick={() => onViewWorkspace(workspace.id)}
        >
          View Workspace →
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onOpenCanvas(workspace.id)}
        >
          Open Pipeline Editor -&gt;
        </Button>
      </div>
    </div>
  )
}
