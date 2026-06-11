'use client'
import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Cpu,
  Plus,
  Power,
  RefreshCw,
  StopCircle,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { workspacesAtom } from '@/store/workspace'
import { useModels } from '@/hooks/workspace/use-models'
import { AIModel } from '@/types'
import { deleteModel } from '@/services/model'
import { ModelTable } from './components/model-table'
import { ModelUpsertDialog } from './components/model-upsert-dialog'
import { ModelLogSheet } from './components/model-log-sheet'
import { ModelPreviewSheet } from './components/model-preview-sheet'

export default function ModelsPage() {
  const workspaces = useAtomValue(workspacesAtom)
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const hasInitialized = useRef(false)
  useEffect(() => {
    if (!hasInitialized.current && workspaces[0]?.id) {
      hasInitialized.current = true
      setWorkspaceId(workspaces[0].id)
    }
  }, [workspaces])
  const {
    data: models,
    loading,
    isFetching,
    refetch,
  } = useModels(workspaceId || null)
  const [search, setSearch] = useState('')
  const [deployFilter, setDeployFilter] = useState<string | null>(null)
  const [prodFilter, setProdFilter] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AIModel | null>(null)
  const [logTarget, setLogTarget] = useState<AIModel | null>(null)
  const [previewTarget, setPreviewTarget] = useState<AIModel | null>(null)

  const all = models ?? []
  const deployCounts = {
    running: all.filter(m => m.data?.deployStatus === 'running').length,
    initializing: all.filter(m => m.data?.deployStatus === 'initializing')
      .length,
    stopped: all.filter(m => m.data?.deployStatus === 'stopped').length,
    failed: all.filter(m => m.data?.deployStatus === 'failed').length,
  }
  const prodCounts = {
    normal: all.filter(m => m.data?.prodStatus === 'normal').length,
    warning: all.filter(m => m.data?.prodStatus === 'warning').length,
    alert: all.filter(m => m.data?.prodStatus === 'alert').length,
    offline: all.filter(m => m.data?.prodStatus === 'offline').length,
  }

  const filtered = all
    .filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
    .filter(m => !deployFilter || m.data?.deployStatus === deployFilter)
    .filter(m => !prodFilter || m.data?.prodStatus === prodFilter)

  async function handleDelete(model: AIModel) {
    try {
      await deleteModel(model.id)
      toast.success('Model deleted')
      void refetch()
    } catch {
      toast.error('Failed to delete model')
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">Models</h1>
            </div>
            {!loading && (
              <p className="mt-0.5 pl-8 text-sm text-muted-foreground">
                {all.length} {all.length === 1 ? 'model' : 'models'}
              </p>
            )}
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditTarget(null)
              setDialogOpen(true)
            }}
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
            <select
              value={workspaceId}
              onChange={e => setWorkspaceId(e.target.value)}
              className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {workspaces.map(ws => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
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
                      key: 'failed',
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
          onPreview={m => setPreviewTarget(m)}
          onEdit={m => {
            setEditTarget(m)
            setDialogOpen(true)
          }}
          onLog={m => setLogTarget(m)}
          onDelete={handleDelete}
        />
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

      <ModelPreviewSheet
        model={previewTarget}
        open={previewTarget !== null}
        onClose={() => setPreviewTarget(null)}
      />
    </div>
  )
}
