'use client'

import {
  ArrowRight,
  Building2,
  ChevronRight,
  Cpu,
  Database,
  X,
  AlertTriangle,
  AlertCircle,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { workspaceIcons } from '@/store/workspace'
import { useModels } from '@/hooks/workspace/use-models'
import { useWorkspacePlants } from '@/hooks/workspace/use-workspace-plants'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'
import {
  CountRow,
  WorkspaceQuota,
} from '@/components/workspace/workspace-quota'
import { failedDeploys, isModelAbnormal } from '@/lib/model-status'
import { OverviewAssetTree } from './overview-asset-tree'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

interface OverviewDetailPanelProps {
  workspace: Workspace | null
  equipmentList: CanvasNode[]
  onClose: () => void
  onViewWorkspace: (id: string) => void
  onViewAlerts: () => void
  onOpenSettings: (id: string) => void
  onViewDataManagement: (id: string) => void
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
  equipmentList,
  onClose,
  onViewWorkspace,
  onViewAlerts,
  onOpenSettings,
  onViewDataManagement,
}: OverviewDetailPanelProps & { workspace: Workspace }) {
  const { data: modelsRaw, isFetching: modelsFetching } = useModels(
    workspace.id,
  )
  const models = modelsRaw ?? []
  const { plants } = useWorkspacePlants(workspace.id)
  const { workspace: detail, loading: detailLoading } = useWorkspace(
    workspace.id,
  )
  const modelsLoading =
    (modelsFetching && modelsRaw === null) || plants === null

  const equipmentCount = equipmentList.length
  const alarmCount = equipmentList.filter(n => n.data.status === 'alarm').length
  const failedCount = failedDeploys(models).length

  // MODEL-SERVE-024-D02. Abnormal = equipment ALERT + abnormal models
  // (failed deploy or monitoring ALERT). Warning/offline equipment and
  // monitoring warnings are not Abnormal; they stay on the Alerts page.
  const abnormalModelCount = models.filter(isModelAbnormal).length
  const abnormalCount = alarmCount + abnormalModelCount

  const IconComponent =
    workspaceIcons.find(i => i.id === workspace.icon)?.icon ?? Building2

  const isAbnormal = abnormalCount > 0
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
            className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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

          {/* One Summary (MODEL-SERVE-040 folded Quota into it). The one status
              figure keeps the full-width cell on top (Von Restorff); under it
              the counts share one list — Equipment, then Models and Members
              against their cap (Proximity: all "what is in this workspace"). */}
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 text-xs font-medium text-muted-foreground">
              Summary
            </div>
            <StatCell
              label="Abnormal"
              value={abnormalCount}
              valueClass={
                abnormalCount > 0
                  ? 'text-destructive'
                  : 'text-green-700 dark:text-green-400'
              }
            />
            <div className="mt-4">
              <WorkspaceQuota
                quota={detail?.quota}
                owner={detail?.owner}
                loading={detailLoading}
              >
                <CountRow label="Equipment" icon={Cpu} value={equipmentCount} />
              </WorkspaceQuota>
            </div>
          </div>

          <OverviewAssetTree
            plants={plants ?? []}
            equipmentList={equipmentList}
            models={models}
            loading={modelsLoading}
          />
        </div>
      </ScrollArea>

      {/* Sticky actions footer, ordered by Laws of UX:
          - Von Restorff: the alert action is the one destructive control,
            shown only when something is wrong, and read first.
          - Hick's Law: one primary action (View Plant). The other two are
            visibly secondary instead of equal-weight bars to choose from.
          - Proximity: Data Management and Settings are both "manage this
            workspace" destinations, so they sit together as a nav list.
          - Jakob's Law: same labels, icons and order as the sidebar's
            workspace links (Overview → Data Management → Settings). */}
      <div className="shrink-0 space-y-3 border-t border-border bg-card/80 px-4 py-4">
        <div className="space-y-2">
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
        </div>
        <nav aria-label="Manage workspace" className="space-y-0.5">
          {[
            {
              label: 'Data Management',
              icon: Database,
              onClick: () => onViewDataManagement(workspace.id),
            },
            {
              label: 'Settings',
              icon: Settings,
              onClick: () => onOpenSettings(workspace.id),
            },
          ].map(item => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <item.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
              />
            </button>
          ))}
        </nav>
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
