'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Cpu,
  Layers,
  Plus,
  Power,
  RefreshCw,
  Snowflake,
  StopCircle,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { workspacesAtom } from '@/store/workspace'
import {
  useAllModels,
  useRefreshModels,
  type ModelWithWorkspace,
} from '@/hooks/use-all-models'
import { useWorkspacePlants } from '@/hooks/workspace/use-workspace-plants'
import { AIModel } from '@/types'
import { deleteModel, updateModel } from '@/services/model'
import { effectiveProdStatus } from '@/lib/model-status'
import { ModelTable } from './components/model-table'
import { WorkTreePanel, type TreeScope } from './components/work-tree-panel'
import { ModelUpsertDialog } from './components/model-upsert-dialog'
import { ModelLogSheet } from './components/model-log-sheet'
import { LoadingModelsViewPage } from './loading'
import { ErrorModelsViewPage } from './error'

// Scope a model to the current sidebar selection (workspace/plant/node/model).
function inScope(m: ModelWithWorkspace, scope: TreeScope | null): boolean {
  if (!scope) return true
  if (scope.level === 'workspace') return m.workspaceId === scope.id
  if (scope.level === 'plant') return m.nodes?.plan?.id === scope.id
  if (scope.level === 'node') return m.nodesId === scope.id
  return m.id === scope.id
}

export default function ModelsPage() {
  const router = useRouter()
  const workspaces = useAtomValue(workspacesAtom)

  // '' = All Workspaces
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [plantFilter, setPlantFilter] = useState<string[]>([])
  const [scope, setScope] = useState<TreeScope | null>(null)

  const { models: allModels, loading, isFetching, refetch } = useAllModels()
  const refreshModels = useRefreshModels()
  const { plants } = useWorkspacePlants(workspaceId || null)

  const [search, setSearch] = useState('')
  const [deployFilter, setDeployFilter] = useState<string | null>(null)
  const [prodFilter, setProdFilter] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AIModel | null>(null)
  const [logTarget, setLogTarget] = useState<AIModel | null>(null)

  const all = allModels ?? []

  // Base: scope + workspace + plant + search — no status filters applied.
  const preStatus: ModelWithWorkspace[] = all
    .filter(m => inScope(m, scope))
    .filter(m => !workspaceId || m.workspaceId === workspaceId)
    .filter(m => {
      if (plantFilter.length === 0) return true
      const planId = m.nodes?.plan?.id
      return planId !== undefined && plantFilter.includes(planId)
    })
    .filter(m => m.name.toLowerCase().includes(search.toLowerCase()))

  // Table rows: all active filters applied.
  const filtered: ModelWithWorkspace[] = preStatus
    .filter(m => !deployFilter || m.data?.deployStatus === deployFilter)
    .filter(m => !prodFilter || effectiveProdStatus(m) === prodFilter)

  // Deploy badge counts: respect prodFilter but NOT deployFilter so that
  // selecting one deploy status doesn't zero out the others.
  const deployBase = preStatus.filter(
    m => !prodFilter || effectiveProdStatus(m) === prodFilter,
  )
  const deployCounts = {
    running: deployBase.filter(m => m.data?.deployStatus === 'running').length,
    initializing: deployBase.filter(
      m => m.data?.deployStatus === 'initializing',
    ).length,
    stopped: deployBase.filter(
      m => (m.data?.deployStatus ?? 'stopped') === 'stopped',
    ).length,
    failed: deployBase.filter(m => m.data?.deployStatus === 'error').length,
  }

  // Prod badge counts: respect deployFilter but NOT prodFilter.
  const prodBase = preStatus.filter(
    m => !deployFilter || m.data?.deployStatus === deployFilter,
  )
  const prodCounts = {
    normal: prodBase.filter(m => effectiveProdStatus(m) === 'normal').length,
    warning: prodBase.filter(m => effectiveProdStatus(m) === 'warning').length,
    alert: prodBase.filter(m => effectiveProdStatus(m) === 'alert').length,
    offline: prodBase.filter(m => effectiveProdStatus(m) === 'offline').length,
    frozen: prodBase.filter(m => effectiveProdStatus(m) === 'frozen').length,
  }

  async function handleDelete(model: AIModel) {
    try {
      await deleteModel(model.id)
      toast.success('Model deleted')
      void refetch()
    } catch {
      toast.error('Failed to delete model')
    }
  }

  async function handleToggleDeploy(
    model: AIModel,
    next: 'running' | 'stopped',
  ) {
    try {
      await updateModel(model.id, { deployStatus: next })
      toast.success(
        next === 'running' ? `${model.name} starting` : `${model.name} stopped`,
      )
      refreshModels()
      await refetch()
    } catch {
      toast.error('Failed to update deploy status')
    }
  }

  function togglePlant(id: string) {
    setPlantFilter(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    )
  }

  if (loading && allModels === null) return <LoadingModelsViewPage />

  if (workspaces.length === 0) {
    return (
      <ErrorModelsViewPage message="No workspaces found. Create a workspace to start using models." />
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <WorkTreePanel selectedScope={scope} onSelectScope={setScope} />

      <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Cpu className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-semibold text-foreground">
                  Models
                </h1>
              </div>
              {!loading && (
                <p className="mt-0.5 pl-8 text-sm text-muted-foreground">
                  {filtered.length} of {all.length}{' '}
                  {all.length === 1 ? 'model' : 'models'}
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => router.push('/models/create')}
            >
              <Plus className="h-4 w-4" />
              New Model
            </Button>
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Filters
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Search models…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 w-56 rounded-md border border-border bg-input px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />

              {/* Workspace selector */}
              <Select
                value={workspaceId || '__all__'}
                onValueChange={val => {
                  setWorkspaceId(val === '__all__' ? '' : val)
                  setPlantFilter([])
                }}
              >
                <SelectTrigger className="h-9 w-48">
                  <SelectValue placeholder="All Workspaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Workspaces</SelectItem>
                  {workspaces.map(ws => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Plant multi-select — only when a workspace is selected */}
              {workspaceId && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 text-sm"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {plantFilter.length > 0
                        ? `${plantFilter.length} plant${plantFilter.length > 1 ? 's' : ''}`
                        : 'All Plants'}
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" align="start">
                    <Command>
                      <CommandList>
                        <CommandEmpty>No plants found.</CommandEmpty>
                        <CommandGroup heading="Plants">
                          {(plants ?? []).map(p => (
                            <CommandItem
                              key={p.id}
                              value={p.name}
                              onSelect={() => togglePlant(p.id)}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4 shrink-0',
                                  plantFilter.includes(p.id)
                                    ? 'opacity-100'
                                    : 'opacity-0',
                                )}
                              />
                              <span className="truncate">{p.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                      {plantFilter.length > 0 && (
                        <div className="border-t p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-muted-foreground"
                            onClick={() => setPlantFilter([])}
                          >
                            × Clear plants
                          </Button>
                        </div>
                      )}
                    </Command>
                  </PopoverContent>
                </Popover>
              )}

              {/* Active sidebar scope */}
              {scope && (
                <button
                  onClick={() => setScope(null)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-red-500 ring-1 ring-red-500/30 hover:bg-primary/10"
                >
                  x clear
                </button>
              )}
            </div>
          </div>

          {/* Status summary */}
          {loading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              {/* Deploy row */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex shrink-0 items-center gap-2">
                  <span className="w-20 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Deployment
                  </span>
                  {deployFilter && (
                    <button
                      onClick={() => setDeployFilter(null)}
                      className="rounded ml-2 px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border hover:text-foreground"
                    >
                      × clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      {
                        key: 'running',
                        label: 'Running',
                        icon: Activity,
                        cls: 'bg-emerald-500/10 text-emerald-500',
                        count: deployCounts.running,
                      },
                      {
                        key: 'initializing',
                        label: 'Initializing',
                        icon: RefreshCw,
                        cls: 'bg-blue-500/10 text-blue-400',
                        count: deployCounts.initializing,
                      },
                      {
                        key: 'stopped',
                        label: 'Stopped',
                        icon: StopCircle,
                        cls: 'bg-zinc-500/10 text-zinc-400',
                        count: deployCounts.stopped,
                      },
                      {
                        key: 'error',
                        label: 'Failed',
                        icon: AlertCircle,
                        cls: 'bg-red-500/10 text-red-500',
                        count: deployCounts.failed,
                      },
                    ] as const
                  ).map(({ key, label, icon: Icon, cls, count }) => {
                    const isActive = deployFilter === key
                    return (
                      <button
                        key={key}
                        onClick={() => setDeployFilter(isActive ? null : key)}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all',
                          cls,
                          isActive
                            ? 'ring-2 ring-current ring-offset-1 opacity-100'
                            : count === 0
                              ? 'opacity-35 hover:opacity-50'
                              : 'hover:opacity-80',
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                        <span className="ml-0.5 font-bold tabular-nums">
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Production row */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex shrink-0 items-center gap-2">
                  <span className="w-20 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Monitoring
                  </span>
                  {prodFilter && (
                    <button
                      onClick={() => setProdFilter(null)}
                      className="rounded ml-2 px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border hover:text-foreground"
                    >
                      × clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      {
                        key: 'normal',
                        label: 'Normal',
                        icon: Activity,
                        cls: 'bg-emerald-500/10 text-emerald-500',
                        count: prodCounts.normal,
                      },
                      {
                        key: 'warning',
                        label: 'Warning',
                        icon: AlertTriangle,
                        cls: 'bg-amber-500/10 text-amber-400',
                        count: prodCounts.warning,
                      },
                      {
                        key: 'alert',
                        label: 'Alert',
                        icon: AlertCircle,
                        cls: 'bg-red-500/10 text-red-500',
                        count: prodCounts.alert,
                      },
                      {
                        key: 'frozen',
                        label: 'Data Frozen',
                        icon: Snowflake,
                        cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
                        count: prodCounts.frozen,
                      },
                      {
                        key: 'offline',
                        label: 'Offline',
                        icon: Power,
                        cls: 'bg-zinc-500/10 text-zinc-400',
                        count: prodCounts.offline,
                      },
                    ] as const
                  ).map(({ key, label, icon: Icon, cls, count }) => {
                    const isActive = prodFilter === key
                    return (
                      <button
                        key={key}
                        onClick={() => setProdFilter(isActive ? null : key)}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all',
                          cls,
                          isActive
                            ? 'ring-2 ring-current ring-offset-1 opacity-100'
                            : count === 0
                              ? 'opacity-35 hover:opacity-50'
                              : 'hover:opacity-80',
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                        <span className="ml-0.5 font-bold tabular-nums">
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Table */}
          <ModelTable
            models={filtered}
            loading={loading}
            isFetching={isFetching}
            onCreateModel={() => router.push('/models/create')}
            onEdit={m => {
              setEditTarget(m)
              setDialogOpen(true)
            }}
            onLog={m => setLogTarget(m)}
            onDelete={handleDelete}
            onToggleDeploy={handleToggleDeploy}
          />
        </div>
      </div>

      <ModelUpsertDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void refetch()}
        workspaces={workspaces}
        model={editTarget}
      />

      <ModelLogSheet
        model={logTarget}
        open={logTarget !== null}
        onClose={() => setLogTarget(null)}
      />
    </div>
  )
}
