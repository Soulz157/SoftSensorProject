'use client'

import {
  ArrowRight,
  Building2,
  X,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { workspaceIcons } from '@/store/workspace'
import { useModels } from '@/hooks/workspace/use-models'
import { useWorkspacePlants } from '@/hooks/workspace/use-workspace-plants'
import { failedDeploys } from '@/lib/model-status'
import { OverviewAssetTree } from './overview-asset-tree'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

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
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-mono text-xl font-semibold tabular-nums',
          valueClass ?? 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

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
  const { plants } = useWorkspacePlants(workspace.id)
  const modelsLoading =
    (modelsFetching && modelsRaw === null) || plants === null

  const nodeCount = nodes.length
  const alarmCount = nodes.filter(n => n.data.status === 'alarm').length
  const warningCount = nodes.filter(n => n.data.status === 'warning').length
  const offlineCount = nodes.filter(n => n.data.status === 'offline').length
  const failedCount = failedDeploys(models).length

  const worstStatus: 'alarm' | 'warning' | 'offline' | 'normal' =
    alarmCount > 0
      ? 'alarm'
      : offlineCount > 0
        ? 'offline'
        : warningCount > 0 || failedCount > 0
          ? 'warning'
          : 'normal'

  const IconComponent =
    workspaceIcons.find(i => i.id === workspace.icon)?.icon ?? Building2

  // Binary display: any non-normal worst status (incl. a failed deploy folded
  // in above) reads as a single red "Abnormal" badge.
  const isAbnormal = worstStatus !== 'normal'
  const statusBadgeClass = isAbnormal
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'

  const statusBadgeText = isAbnormal ? 'Abnormal' : 'All Systems Normal'

  return (
    <div className="flex h-full w-full flex-col border-t border-border bg-card sm:w-75 sm:shrink-0 sm:border-l sm:border-t-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <IconComponent className="h-5 w-5 text-foreground" />
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
              {isAbnormal && (
                <AlertCircle
                  aria-hidden="true"
                  className="mr-1.5 h-3.5 w-3.5"
                />
              )}
              {statusBadgeText}
            </div>

            {failedCount > 0 && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />
                {failedCount} model deploy{failedCount > 1 ? 's' : ''} failed
              </div>
            )}
          </div>

          {/* Stats grid 2×2 */}
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 text-xs font-medium text-muted-foreground">
              Summary
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCell label="Equipment" value={nodeCount} />
              <StatCell
                label="Models"
                value={workspace._count.models ? workspace._count.models : 0}
              />
              <StatCell
                label="Abnormal"
                value={alarmCount + warningCount + offlineCount}
                valueClass={
                  alarmCount + warningCount + offlineCount > 0
                    ? 'text-destructive'
                    : 'text-green-700 dark:text-green-400'
                }
              />
            </div>
          </div>

          <OverviewAssetTree
            plants={plants ?? []}
            nodes={nodes}
            models={models}
            loading={modelsLoading}
          />
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
          View Plant
          <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => onOpenPipeEditor(workspace.id)}
        >
          Open Pipeline Editor
          <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
        </Button>
      </div>
    </div>
  )
}

export function OverviewDetailPanel(props: OverviewDetailPanelProps) {
  if (!props.workspace) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 border-t border-border bg-card p-6 text-center sm:w-75 sm:shrink-0 sm:border-l sm:border-t-0">
        <Building2 className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">
          Select a plant to view details
        </p>
      </div>
    )
  }

  return <PanelContent {...props} workspace={props.workspace} />
}
