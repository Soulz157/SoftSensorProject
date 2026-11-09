'use client'

import React, { use, memo, useEffect, useRef } from 'react'
import { isEquipmentAbnormal } from '@/lib/overview-status'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Building2,
  Grid2X2,
  Map,
  Cpu,
  AlertTriangle,
  Database,
} from 'lucide-react'
import Link from 'next/link'
import { IsometricMap } from './components/isometric-map'
import { EquipmentDetailPanel } from './components/equipment-detail-panel'
import type { CanvasNode } from '@/services/canvas'
import { Button } from '@/components/ui/button'
import { AddPlanDialog } from './components/plant-dialog'
import { AddEquipmentDialog } from './components/add-equipment-dialog'
import { cn } from '@/lib/utils'
import { usePlantsController } from '@/hooks/plants/use-plant-controller'

// Binary equipment status through THE one rule (MODEL-SERVE-024-D02): red
// Abnormal only for an alerting node or one carrying an abnormal model;
// warning/offline read green Normal.
const BINARY_DOT = { normal: 'bg-green-500', abnormal: 'bg-red-500' } as const
const BINARY_TEXT = {
  normal: 'text-green-700 dark:text-green-400',
  abnormal: 'text-red-700 dark:text-red-400',
} as const

const EquipmentGridView = memo(function EquipmentGridView({
  equipmentList,
  selectedEquipmentId,
  onEquipmentClick,
  failedEquipmentIds,
  abnormalModelEquipmentIds,
}: {
  equipmentList: CanvasNode[]
  selectedEquipmentId: string | null
  onEquipmentClick: (equipmentId: string) => void
  failedEquipmentIds: Set<string>
  /** MODEL-SERVE-024-D02. Equipment carrying an abnormal model. */
  abnormalModelEquipmentIds: ReadonlySet<string>
}) {
  if (equipmentList.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-center">
        <Cpu className="h-10 w-10 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-foreground">
            No equipment in this plant
          </p>
          <p className="text-xs text-muted-foreground">
            Create equipment in Canvas to populate this operations grid.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {equipmentList.map(equipment => {
          const binary = isEquipmentAbnormal(
            equipment,
            abnormalModelEquipmentIds,
          )
            ? 'abnormal'
            : 'normal'
          const hasFailedModel = failedEquipmentIds.has(equipment.id)
          const selected = selectedEquipmentId === equipment.id
          return (
            <div
              key={equipment.id}
              onClick={() => onEquipmentClick(equipment.id)}
              className={cn(
                'group flex flex-col justify-between rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/60 hover:shadow-md cursor-pointer',
                selected && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              <div>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">
                      {equipment.data.name}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {equipment.data.type} node
                    </p>
                  </div>
                  <span
                    className={cn(
                      'mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow-sm',
                      BINARY_DOT[binary],
                      binary === 'abnormal' &&
                        'animate-pulse ring-2 ring-red-500/30',
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-muted-foreground mb-1">Status</p>
                    <p className={cn('font-semibold', BINARY_TEXT[binary])}>
                      {binary === 'abnormal' ? 'Abnormal' : 'Normal'}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-muted-foreground mb-1">Models</p>
                    <p className="font-semibold text-foreground">
                      {equipment.models?.length || 0} Connected
                    </p>
                  </div>
                  {hasFailedModel && (
                    <div className="col-span-2 mt-1 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Model deploy failed
                    </div>
                  )}
                </div>
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
  const { nodeId: equipmentId } = use(searchParams)

  const { state, data, setters, handlers } = usePlantsController(
    id,
    equipmentId ?? null,
  )

  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.isPanelOpen) panelRef.current?.focus()
  }, [state.isPanelOpen])

  useEffect(() => {
    if (!state.isPanelOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlers.handleClosePanel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.isPanelOpen, handlers])

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
            {data.deployFailedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3 w-3" />
                {data.deployFailedCount} Model Failed
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

            {data.selectedEquipment && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="flex items-center gap-2">
                  <span className="max-w-36 truncate font-semibold text-foreground">
                    {data.selectedEquipment.data.name}
                  </span>
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
          {/* Laws of UX: the toolbar is two groups split by a divider
              (Proximity / Common Region). Left changes how THIS page is
              viewed; right leaves for, or adds to, the workspace. Data
              Management uses the sidebar's label and icon (Jakob's Law).
              The single primary action sits last, where the eye ends
              (Serial Position Effect). */}
          <div aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="ghost" className="h-8 gap-1.5" asChild>
            <Link href={`/analytics/${state.activeWorkspaceId || id}`}>
              <Database className="h-4 w-4" />
              Data Management
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={handlers.handleOpenAddPlan}
          >
            <Plus className="h-4 w-4" />
            Create Plant
          </Button>
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
              equipmentList={data.filteredEquipmentList}
              workspaceEquipmentList={data.workspaceEquipmentList}
              zoneEquipmentKey="planId"
              selectedZoneId={state.selectedPlanId}
              selectedEquipmentId={state.selectedEquipmentId}
              onZoneSelect={handlers.handleZoneSelect}
              onZoneDoubleClick={handlers.handleDrillDown}
              onEquipmentClick={handlers.handleEquipmentClick}
              viewMode={state.viewMode}
              abnormalModelEquipmentIds={data.abnormalModelEquipmentIds}
            />
          ) : (
            <EquipmentGridView
              equipmentList={data.visibleGridEquipmentList}
              selectedEquipmentId={state.selectedEquipmentId}
              onEquipmentClick={handlers.handleEquipmentClick}
              failedEquipmentIds={data.failedEquipmentIds}
              abnormalModelEquipmentIds={data.abnormalModelEquipmentIds}
            />
          )}
        </main>

        {state.isPanelOpen &&
          (data.selectedEquipment || data.breadcrumbPlant) && (
            <>
              <div
                className="fixed inset-0 z-10 bg-black/30 sm:hidden"
                onClick={handlers.handleClosePanel}
                aria-hidden="true"
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={
                  data.selectedEquipment
                    ? `${data.selectedEquipment.data.name} — equipment details`
                    : `${data.breadcrumbPlant?.name} — plant details`
                }
                tabIndex={-1}
                className="fixed inset-x-0 bottom-0 z-20 h-[65svh] overflow-hidden rounded-t-2xl outline-none sm:relative sm:inset-auto sm:z-auto sm:h-full sm:rounded-none"
              >
                <EquipmentDetailPanel
                  viewMode={state.inspectorMode}
                  equipment={data.selectedEquipment}
                  plan={data.breadcrumbPlant}
                  planEquipmentList={data.filteredEquipmentList.filter(
                    n => n.planId === state.selectedPlanId,
                  )}
                  workspaceId={state.activeWorkspaceId}
                  onDrillDown={handlers.handleDrillDown}
                  onEditClick={equipment =>
                    handlers.handleOpenEditEquipment(equipment.id)
                  }
                  onDeleteClick={equipment =>
                    handlers.handleDeleteEquipment(equipment.id)
                  }
                  onClose={handlers.handleClosePanel}
                />
              </div>
            </>
          )}
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
        onSubmit={handlers.handleAddEquipment}
      />

      {/* MODEL-SERVE-025-D02. The same form in edit mode (name, type,
          status) — the canvas page it used to live on is gone. */}
      <AddEquipmentDialog
        open={state.editingEquipmentId !== null}
        plantName={data.breadcrumbPlant?.name ?? ''}
        equipment={
          data.workspaceEquipmentList.find(
            n => n.id === state.editingEquipmentId,
          ) ?? null
        }
        onClose={handlers.handleCloseEditEquipment}
        onSubmit={handlers.handleEditEquipment}
      />
    </div>
  )
}
