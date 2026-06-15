'use client'

import React, { use, memo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Building2,
  Grid2X2,
  Map,
  Cpu,
  AlertTriangle,
  Workflow,
  ExternalLink,
} from 'lucide-react'
import { IsometricMap } from './components/isometric-map'
import { NodeDetailPanel } from './components/node-detail-panel'
import type { NodeStatus } from '../../../../store/status-colors'
import type { CanvasNode } from '@/services/canvas'
import { Button } from '@/components/ui/button'
import { AddPlanDialog } from './components/plant-dialog'
import { AddEquipmentDialog } from './components/add-equipment-dialog'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { usePlantsController } from '@/hooks/plants/use-plant-controller'

const STATUS_DOT: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  alarm: 'bg-red-500',
  offline: 'bg-zinc-500',
}

const STATUS_TEXT: Record<NodeStatus, string> = {
  normal: 'text-emerald-500',
  warning: 'text-amber-500',
  alarm: 'text-red-500',
  offline: 'text-zinc-400',
}

function formatStatus(status: NodeStatus) {
  if (status === 'normal') return 'Healthy'
  if (status === 'alarm') return 'Alarm'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const EquipmentGridView = memo(function EquipmentGridView({
  nodes,
  selectedNodeId,
  onNodeClick,
  workspaceId,
}: {
  nodes: CanvasNode[]
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  workspaceId: string | null
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-center">
        <Cpu className="h-10 w-10 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-foreground">
            No equipment in this plant
          </p>
          <p className="text-xs text-muted-foreground">
            Create nodes in Canvas to populate this operations grid.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nodes.map(node => {
          const status = node.data.status as NodeStatus
          const selected = selectedNodeId === node.id
          return (
            <div
              key={node.id}
              onClick={() => onNodeClick(node.id)}
              className={cn(
                'group flex flex-col justify-between rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/60 hover:shadow-md cursor-pointer',
                selected && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              <div>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">
                      {node.data.name}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {node.data.type} node
                    </p>
                  </div>
                  <span
                    className={cn(
                      'mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow-sm',
                      STATUS_DOT[status],
                      status === 'alarm' &&
                        'animate-pulse ring-2 ring-red-500/30',
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-muted-foreground mb-1">Status</p>
                    <p className={cn('font-semibold', STATUS_TEXT[status])}>
                      {formatStatus(status)}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-muted-foreground mb-1">AI Models</p>
                    <p className="font-semibold text-foreground">
                      {node.models?.length || 0} Connected
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-4 justify-end ">
                <Link
                  href={cn(
                    `/workspaces/${workspaceId}/canvas?nodeId=${node.id}`,
                    selected ? '' : 'hover:bg-accent/50',
                  )}
                >
                  <Button
                    size="sm"
                    className="cursor-pointer gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={e => {
                      e.stopPropagation()
                      console.log('Open Pipeline for:', node.id)
                    }}
                  >
                    <Workflow className="h-3.5 w-3.5" />
                    Process Pipeline
                  </Button>
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

interface PlantsPageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    nodeId?: string
  }>
}

export default function PlantsPage({ params, searchParams }: PlantsPageProps) {
  const { id } = use(params)
  const { nodeId } = use(searchParams)

  const { state, data, setters, handlers } = usePlantsController(
    id,
    nodeId ?? null,
  )

  if (data.loading) return null

  if (data.error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {data.error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Plants Overview</span>
            {data.alarmCount > 0 && (
              <span className="inline-flex items-center gap-1 text-red-500">
                <AlertTriangle className="h-3 w-3" />
                {data.alarmCount} Alarm
              </span>
            )}
            {data.warningCount > 0 && (
              <span className="text-amber-500">
                {data.warningCount} Warning
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />

            {/* Optimizatin 4: เอา Callback มาผูกแทน Arrow Function */}
            <button
              onClick={handlers.handleResetToPlantsView}
              className="max-w-40 truncate font-semibold text-foreground hover:text-primary transition-all cursor-pointer"
            >
              {data.selectedWorkspace?.name ?? 'No Workspace'}
            </button>

            {data.breadcrumbPlant && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <button
                  onClick={handlers.handleResetToEquipmentView}
                  className="max-w-36 truncate font-semibold text-foreground hover:text-primary transition-all cursor-pointer"
                >
                  {data.breadcrumbPlant.name}
                </button>
              </>
            )}

            {data.selectedNode && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="flex items-center gap-2">
                  <span className="max-w-36 truncate font-semibold text-foreground">
                    {data.selectedNode.data.name}
                  </span>
                  <Link
                    href={`/workspaces/${state.activeWorkspaceId}/canvas?nodeId=${data.selectedNode.id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-500 hover:bg-blue-500/20 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Pipeline Editor
                  </Link>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.viewMode === 'equipment' && data.selectedPlan && (
            <button
              type="button"
              onClick={handlers.handleBack}
              className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              All Plants
            </button>
          )}
          <div className="flex h-8 rounded-md border border-border bg-muted/30 p-0.5">
            {(['map', 'grid'] as const).map(mode => {
              const Icon = mode === 'map' ? Map : Grid2X2
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setters.setDisplayMode(mode)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium capitalize text-muted-foreground transition-colors',
                    state.displayMode === mode &&
                      'bg-primary text-primary-foreground shadow-sm',
                  )}
                  aria-pressed={state.displayMode === mode}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mode}
                </button>
              )
            })}
          </div>
          {state.viewMode === 'equipment' && state.selectedPlanId && (
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={handlers.handleOpenAddEquipment}
            >
              <Plus className="h-4 w-4" />
              Add Equipment
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={handlers.handleOpenAddPlan}
          >
            <Plus className="h-4 w-4" />
            Create Plant
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {state.displayMode === 'map' ? (
            <IsometricMap
              zones={
                state.viewMode === 'plants'
                  ? data.plants
                  : data.selectedPlan
                    ? [data.selectedPlan]
                    : []
              }
              nodes={data.filteredNodes}
              zoneNodeKey="planId"
              selectedZoneId={state.selectedPlanId}
              selectedNodeId={state.selectedNodeId}
              onZoneSelect={handlers.handleZoneSelect}
              onZoneDoubleClick={handlers.handleDrillDown}
              onNodeClick={handlers.handleNodeClick}
              viewMode={state.viewMode}
            />
          ) : (
            <EquipmentGridView
              nodes={data.visibleGridNodes}
              selectedNodeId={state.selectedNodeId}
              onNodeClick={handlers.handleNodeClick}
              workspaceId={state.activeWorkspaceId}
            />
          )}
        </main>

        <NodeDetailPanel
          viewMode={state.inspectorMode}
          node={data.selectedNode}
          plan={data.breadcrumbPlant}
          planNodes={data.filteredNodes.filter(
            n => n.planId === state.selectedPlanId,
          )}
          workspaceId={state.activeWorkspaceId}
          onDrillDown={handlers.handleDrillDown}
          isOpen={state.isPanelOpen}
          onClose={handlers.handleClosePanel}
        />
      </div>

      <AddPlanDialog
        open={state.isAddPlanOpen}
        onClose={handlers.handleCloseAddPlan}
        workspaceName={data.selectedWorkspace?.name || 'Workspace'}
        onAddPlan={handlers.handleCreatePlan}
      />

      <AddEquipmentDialog
        open={state.isAddEquipmentOpen}
        plantName={data.selectedPlan?.name ?? ''}
        onClose={handlers.handleCloseAddEquipment}
        onAdd={handlers.handleAddEquipment}
      />
    </div>
  )
}
