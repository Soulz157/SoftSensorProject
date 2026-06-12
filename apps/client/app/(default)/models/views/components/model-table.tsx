'use client'
import { useState, useMemo } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  Cpu,
  Info,
  Layers,
  MoreHorizontal,
  Pencil,
  Power,
  RefreshCw,
  StopCircle,
  Terminal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIModel, Workspace, WorkspacePlant } from '@/types'
import { type ModelWithWorkspace } from '@/hooks/use-all-models'
import { type CanvasNode } from '@/services/canvas'
import { effectiveProdStatus } from '@/lib/model-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ModelDetailDialog } from './model-detail-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import Link from 'next/link'
import { toast } from 'sonner'

const DEPLOY_MAP = {
  running: {
    label: 'Running',
    icon: Activity,
    cls: 'bg-emerald-500/15 text-emerald-500',
  },
  stopped: {
    label: 'Stopped',
    icon: StopCircle,
    cls: 'bg-zinc-500/15 text-zinc-400',
  },
  error: {
    label: 'Failed',
    icon: AlertCircle,
    cls: 'bg-red-500/15 text-red-500',
  },
  initializing: {
    label: 'Initializing',
    icon: RefreshCw,
    cls: 'bg-blue-500/15 text-blue-400',
  },
} as const

const PROD_MAP = {
  normal: {
    label: 'Normal',
    icon: Activity,
    cls: 'bg-emerald-500/15 text-emerald-500',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    cls: 'bg-amber-500/15 text-amber-500',
  },
  alert: {
    label: 'Alert',
    icon: AlertCircle,
    cls: 'bg-red-500/15 text-red-500',
  },
  offline: {
    label: 'Offline',
    icon: Power,
    cls: 'bg-zinc-500/15 text-zinc-400',
  },
} as const

type DS = keyof typeof DEPLOY_MAP

interface Props {
  models: ModelWithWorkspace[]
  loading: boolean
  isFetching: boolean
  masterWorkspaces: Workspace[]
  masterPlantsByWorkspaceId: Record<string, WorkspacePlant[]>
  masterNodesByWorkspaceId: Record<string, CanvasNode[]>
  onCreateModel?: () => void
  onEdit: (m: AIModel) => void
  onLog: (m: AIModel) => void
  onDelete: (m: AIModel) => void
  onToggleDeploy: (m: AIModel, next: 'running' | 'stopped') => Promise<void>
}

interface EquipmentEntry {
  id: string
  name: string
  models: ModelWithWorkspace[]
}
interface PlantEntry {
  id: string
  name: string
  equipment: EquipmentEntry[]
}
interface WorkspaceEntry {
  id: string
  name: string
  plants: PlantEntry[]
}

interface ModelRowsProps {
  items: ModelWithWorkspace[]
  isFetching: boolean
  optimisticStates: Record<string, string>
  mutatingId: string | null
  onToggle: (m: AIModel, next: 'running' | 'stopped') => void
  onLog: (m: AIModel) => void
  onEdit: (m: AIModel) => void
  onDetail: (m: AIModel) => void
  onDelete: (m: AIModel) => void
}

function ModelRows({
  items,
  isFetching,
  optimisticStates,
  mutatingId,
  onToggle,
  onLog,
  onEdit,
  onDetail,
  onDelete,
}: ModelRowsProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Deploy</TableHead>
          <TableHead>Monitoring</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody
        className={cn(
          'transition-opacity duration-200',
          isFetching && 'opacity-60',
        )}
      >
        {items.map(m => {
          const actualDeployKey = m.data?.deployStatus ?? 'stopped'
          const deployKey = (optimisticStates[m.id] ?? actualDeployKey) as DS

          const ds = DEPLOY_MAP[deployKey] ?? DEPLOY_MAP.stopped
          const prodKey = effectiveProdStatus(m)
          const ps = PROD_MAP[prodKey]

          const monitoringDisabled =
            deployKey === 'stopped' || deployKey === 'error'
          const DIcon = ds.icon
          const PIcon = ps.icon
          const isMutating = mutatingId === m.id
          const isOn = deployKey === 'running' || deployKey === 'initializing'

          return (
            <TableRow key={m.id}>
              <TableCell>
                <Link href={`/models/${m.id}`}>
                  <button className="cursor-pointer font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
                    {m.name}
                  </button>
                </Link>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={isOn}
                    disabled={deployKey === 'initializing' || isMutating}
                    onCheckedChange={checked =>
                      void onToggle(m, checked ? 'running' : 'stopped')
                    }
                    aria-label={isOn ? `Stop ${m.name}` : `Start ${m.name}`}
                    className={cn(
                      deployKey === 'running' &&
                        'data-[state=checked]:bg-emerald-500',
                      deployKey === 'stopped' &&
                        'data-[state=unchecked]:bg-zinc-400',
                      deployKey === 'error' &&
                        'data-[state=unchecked]:bg-red-500 data-[state=checked]:bg-red-500',
                    )}
                  />
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                      ds.cls,
                    )}
                  >
                    <DIcon
                      className={cn(
                        'h-3 w-3',
                        deployKey === 'initializing' && 'animate-spin',
                      )}
                    />
                    {ds.label}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    ps.cls,
                    monitoringDisabled &&
                      'opacity-50 ring-1 ring-inset ring-zinc-500/30',
                  )}
                >
                  <PIcon className="h-3 w-3" />
                  {ps.label}
                </span>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onLog(m)}>
                      <Terminal className="h-3.5 w-3.5" />
                      Console
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(m)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDetail(m)}>
                      <Info className="h-3.5 w-3.5" />
                      Details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function ModelTable({
  models,
  loading,
  isFetching,
  masterWorkspaces,
  masterPlantsByWorkspaceId,
  masterNodesByWorkspaceId,
  onCreateModel,
  onEdit,
  onLog,
  onDelete,
  onToggleDeploy,
}: Props) {
  const [detailModel, setDetailModel] = useState<AIModel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIModel | null>(null)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [optimisticStates, setOptimisticStates] = useState<
    Record<string, string>
  >({})

  async function handleToggle(m: AIModel, next: 'running' | 'stopped') {
    setMutatingId(m.id)
    const previousState =
      optimisticStates[m.id] || (m.data?.deployStatus ?? 'stopped')
    setOptimisticStates(prev => ({ ...prev, [m.id]: next }))

    try {
      await onToggleDeploy(m, next)
    } catch {
      toast.error('Failed to update deployment status. Please try again.')
      setOptimisticStates(prev => ({ ...prev, [m.id]: previousState }))
    } finally {
      setMutatingId(null)
    }
  }

  const hierarchyData = useMemo<WorkspaceEntry[]>(() => {
    return masterWorkspaces.map(ws => {
      const plants = (masterPlantsByWorkspaceId[ws.id] ?? []).map(plant => {
        const wsNodes = masterNodesByWorkspaceId[ws.id] ?? []
        const plantNodes = wsNodes.filter(n => n.planId === plant.id)
        const equipment: EquipmentEntry[] = plantNodes.map(node => ({
          id: node.id,
          name: (node.data.name as string | undefined) ?? 'Unnamed Equipment',
          models: models.filter(m => m.nodesId === node.id),
        }))
        return { id: plant.id, name: plant.name, equipment }
      })
      return { id: ws.id, name: ws.name, plants }
    })
  }, [
    models,
    masterWorkspaces,
    masterPlantsByWorkspaceId,
    masterNodesByWorkspaceId,
  ])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map(i => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="flex items-center gap-3 px-5 py-4">
              <Skeleton className="h-5 w-5 rounded-md" />
              <Skeleton className="h-5 w-40 rounded-md" />
              <Skeleton className="ml-1 h-4 w-8 rounded-full" />
            </div>
            <div className="space-y-3 px-5 pb-5">
              {[0, 1].map(j => (
                <div
                  key={j}
                  className="ml-1 space-y-2 border-l-2 border-border pl-4"
                >
                  <Skeleton className="h-4 w-28 rounded-md" />
                  <div className="space-y-1.5 pl-4">
                    {[0, 1, 2].map(k => (
                      <Skeleton key={k} className="h-9 w-full rounded-md" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (masterWorkspaces.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
        <Activity className="h-10 w-10 opacity-30" />
        <p className="text-base font-medium">No models yet</p>
        <p className="text-sm">Create a model and assign it to equipment.</p>
      </div>
    )
  }

  const firstWs = hierarchyData[0]

  return (
    <>
      <div className="space-y-3">
        <Accordion
          type="multiple"
          className="w-full space-y-3"
          defaultValue={firstWs ? [`ws-${firstWs.id}`] : []}
        >
          {hierarchyData.map(ws => {
            const totalModels = ws.plants
              .flatMap(p => p.equipment)
              .flatMap(e => e.models).length
            const firstPlant = ws.plants[0]

            return (
              <AccordionItem
                value={`ws-${ws.id}`}
                key={ws.id}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              >
                <AccordionTrigger className="px-5 py-4 transition-colors hover:bg-accent/50 hover:no-underline [&>svg]:shrink-0">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 shrink-0 text-primary" />
                    <span className="text-lg font-semibold text-foreground">
                      {ws.name}
                    </span>
                    <Badge variant="secondary" className="ml-1 tabular-nums">
                      {totalModels} {totalModels === 1 ? 'model' : 'models'}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-5 pb-5 pt-1">
                  {ws.plants.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No plants in this workspace.
                    </p>
                  ) : (
                    <Accordion
                      type="multiple"
                      className="w-full space-y-1"
                      defaultValue={firstPlant ? [`pl-${firstPlant.id}`] : []}
                    >
                      {ws.plants.map(plant => (
                        <AccordionItem
                          value={`pl-${plant.id}`}
                          key={plant.id}
                          className="ml-1 border-l-2 border-border pl-4"
                        >
                          <AccordionTrigger className="py-2.5 hover:no-underline [&>svg]:shrink-0">
                            <div className="flex items-center gap-2">
                              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                                {plant.name}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-2 pt-1">
                            {plant.equipment.length === 0 ? (
                              <p className="py-4 text-center text-sm text-muted-foreground">
                                No equipment assigned to this plant.
                              </p>
                            ) : (
                              <Accordion
                                type="multiple"
                                className="w-full space-y-1"
                                defaultValue={plant.equipment.map(
                                  eq => `eq-${eq.id}`,
                                )}
                              >
                                {plant.equipment.map(eq => (
                                  <AccordionItem
                                    value={`eq-${eq.id}`}
                                    key={eq.id}
                                    className="ml-1 border-l-2 border-primary/20 pl-4"
                                  >
                                    <AccordionTrigger className="py-2 hover:no-underline [&>svg]:shrink-0">
                                      <div className="flex items-center gap-2">
                                        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="text-sm">
                                          {eq.name}
                                        </span>
                                        <Badge
                                          variant="secondary"
                                          className="ml-1 h-4 px-1.5 py-0 text-[10px]"
                                        >
                                          {eq.models.length}{' '}
                                          {eq.models.length === 1
                                            ? 'Model'
                                            : 'Models'}
                                        </Badge>
                                      </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="pt-2">
                                      {eq.models.length === 0 ? (
                                        <div className="py-4 text-center text-sm text-muted-foreground">
                                          No models assigned to this equipment.{' '}
                                          <button
                                            onClick={onCreateModel}
                                            className="font-medium text-primary underline-offset-2 hover:underline"
                                          >
                                            Create a model
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="overflow-hidden rounded-md border bg-background">
                                          <ModelRows
                                            items={eq.models}
                                            isFetching={isFetching}
                                            optimisticStates={optimisticStates}
                                            mutatingId={mutatingId}
                                            onToggle={handleToggle}
                                            onLog={onLog}
                                            onEdit={onEdit}
                                            onDetail={setDetailModel}
                                            onDelete={setDeleteTarget}
                                          />
                                        </div>
                                      )}
                                    </AccordionContent>
                                  </AccordionItem>
                                ))}
                              </Accordion>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &quot;{deleteTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ModelDetailDialog
        model={detailModel}
        open={detailModel !== null}
        onClose={() => setDetailModel(null)}
      />
    </>
  )
}
