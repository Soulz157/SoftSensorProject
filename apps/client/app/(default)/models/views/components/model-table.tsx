'use client'
import { useState } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Braces,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Snowflake,
  StopCircle,
  Terminal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIModel } from '@/types'
import { type ModelWithWorkspace } from '@/hooks/use-all-models'
import { monitoringStatus } from '@/lib/model-status'
import { Button } from '@/components/ui/button'
import { ModelDetailDialog } from './model-detail-dialog'
import { ViewConfigDialog } from './view-config-dialog'
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
  DropdownMenuLabel,
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
import Link from 'next/link'
import { toast } from 'sonner'

const DEPLOY_MAP = {
  running: {
    label: 'Running',
    icon: Activity,
    cls: 'bg-emerald-500/15 text-emerald-500',
  },
  stopped: {
    label: 'Offline',
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
  // Data frozen / missing data — purple, with a brief reason shown alongside.
  frozen: {
    label: 'Data Frozen',
    icon: Snowflake,
    cls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  },
} as const

type DS = keyof typeof DEPLOY_MAP

function formatDeployedAt(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  models: ModelWithWorkspace[]
  loading: boolean
  isFetching: boolean
  onCreateModel?: () => void
  onEdit: (m: AIModel) => void
  onLog: (m: AIModel) => void
  onDelete: (m: AIModel) => void
  onToggleDeploy: (m: AIModel, next: 'running' | 'stopped') => Promise<void>
}

export function ModelTable({
  models,
  loading,
  isFetching,
  onCreateModel,
  onEdit,
  onLog,
  onDelete,
  onToggleDeploy,
}: Props) {
  const [detailModel, setDetailModel] = useState<AIModel | null>(null)
  const [configModel, setConfigModel] = useState<AIModel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIModel | null>(null)
  const [deployTarget, setDeployTarget] = useState<{
    model: AIModel
    next: 'running' | 'stopped'
  } | null>(null)
  const [mutating, setMutating] = useState<{
    id: string
    next: 'running' | 'stopped'
  } | null>(null)

  /**
   * No optimistic state. It used to flip the control to the requested
   * setting at press and roll back only if `onToggleDeploy` threw, but the
   * page's handler catches its own failure (it toasts the server's reason),
   * so a refused Start never threw: the control stayed ON, the stale
   * override was never cleared, and the row read "running" over a model the
   * server never started. The row now shows a spinner while the call is in
   * flight and then renders whatever the refetched model says, success or
   * failure. The handler owns the toast and the refetch in both branches.
   */
  async function handleToggle(m: AIModel, next: 'running' | 'stopped') {
    setMutating({ id: m.id, next })
    try {
      await onToggleDeploy(m, next)
    } catch {
      // Only reached by a caller whose handler rethrows; the views page's
      // own handler never does.
      toast.error('Failed to update deployment status. Please try again.')
    } finally {
      setMutating(null)
    }
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-20 text-center text-muted-foreground">
        <Activity className="h-10 w-10 opacity-30" />
        <p className="text-base font-medium">No models match</p>
        <p className="text-sm">
          Adjust the filters or{' '}
          {onCreateModel && (
            <button
              onClick={onCreateModel}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              create a model
            </button>
          )}
          .
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Deploy</TableHead>
              <TableHead>Monitoring</TableHead>
              <TableHead>Deployed By</TableHead>
              <TableHead>Deployed At</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody
            className={cn(
              'transition-opacity duration-200',
              isFetching && 'opacity-60',
            )}
          >
            {models.map(m => {
              const isMutating = mutating?.id === m.id
              // While a Start is in flight the badge reads Initializing — the
              // request runs the source preflight and can take seconds, and
              // "Offline" under a pressed Start reads as nothing happening.
              // Transitional only: once the call resolves the row shows the
              // refetched server status (Running, Failed, or still Offline
              // after a refusal), never this.
              const deployKey = (
                isMutating && mutating?.next === 'running'
                  ? 'initializing'
                  : (m.data?.deployStatus ?? 'stopped')
              ) as DS

              const ds = DEPLOY_MAP[deployKey] ?? DEPLOY_MAP.stopped
              // MODEL-SERVE-012-T08. The MEASURED monitoring verdict off the
              // list payload — no longer the hand-set `prodStatus` column,
              // which could read "Normal" for a model the detail page badged
              // Alert. `deriveDeployStatuses` now grades the output-error
              // axis in two batched queries for the whole page.
              const prodKey = monitoringStatus(m)
              const ps = PROD_MAP[prodKey]

              const monitoringDisabled =
                deployKey === 'stopped' || deployKey === 'error'
              const DIcon = ds.icon
              const PIcon = ps.icon
              // MODEL-SERVE-001-T19. Start vs Stop follows a SETTING the
              // operator owns (`enabled`), never the DERIVED `deployStatus`
              // badge beside it — an enabled-but-failing schedule reads
              // status 'error' while `enabled` stays true, and binding the
              // control to `deployKey` left that model with no Stop control
              // anywhere (it read OFF, and the only action it offered wrote
              // `enabled: true`).
              const isOn = m.data?.enabled ?? false
              const isFrozen = prodKey === 'frozen'

              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/models/${m.id}`}>
                      <button className="cursor-pointer font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
                        {m.name}
                      </button>
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {m.nodes?.plan?.name ?? m.workspaceName}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* MODEL-SERVE-001-T19 still holds: the control
                          follows the SETTING (`enabled`), never the derived
                          `deployStatus` badge beside it, so an enabled but
                          failing schedule offers Stop. Start/Stop buttons
                          match the model detail page's header. */}
                      {isOn ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 px-2.5 text-xs"
                          disabled={deployKey === 'initializing' || isMutating}
                          onClick={() =>
                            setDeployTarget({ model: m, next: 'stopped' })
                          }
                          aria-label={`Stop ${m.name}`}
                        >
                          {isMutating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <StopCircle className="h-3.5 w-3.5" />
                          )}
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 px-2.5 text-xs"
                          disabled={isMutating}
                          onClick={() =>
                            setDeployTarget({ model: m, next: 'running' })
                          }
                          aria-label={`Start ${m.name}`}
                        >
                          {isMutating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          Start
                        </Button>
                      )}
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
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={cn(
                          'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                          ps.cls,
                          monitoringDisabled &&
                            'opacity-50 ring-1 ring-inset ring-zinc-500/30',
                        )}
                      >
                        <PIcon className="h-3 w-3" />
                        {ps.label}
                      </span>
                      {isFrozen && m.data?.statusDetail && (
                        <span className="max-w-[16rem] truncate text-[11px] text-purple-600/80 dark:text-purple-400/80">
                          {m.data.statusDetail}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.data?.deployedBy ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                    {formatDeployedAt(m.data?.deployedAt)}
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
                      <DropdownMenuContent align="end" className="w-full">
                        {m.data?.lastEditedBy && (
                          <>
                            <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
                              Last edited by {m.data.lastEditedBy}
                              {m.data.lastEditedAt &&
                                ` · ${formatDeployedAt(m.data.lastEditedAt)}`}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem onClick={() => onLog(m)}>
                          <Terminal className="h-3.5 w-3.5" />
                          Console
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/models/create?mode=edit&modelId=${m.id}&workspaceId=${m.workspaceId}`}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Edit configuration
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDetailModel(m)}>
                          <Info className="h-3.5 w-3.5" />
                          Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setConfigModel(m)}>
                          <Braces className="h-3.5 w-3.5" />
                          View config
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(m)}
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

      <AlertDialog
        open={deployTarget !== null}
        onOpenChange={open => !open && setDeployTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deployTarget?.next === 'running'
                ? `Start "${deployTarget.model.name}"?`
                : `Stop "${deployTarget?.model.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deployTarget?.next === 'running'
                ? 'This will begin inference. Running models consume resources.'
                : 'This will halt inference immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deployTarget)
                  void handleToggle(deployTarget.model, deployTarget.next)
                setDeployTarget(null)
              }}
            >
              {deployTarget?.next === 'running' ? 'Start' : 'Stop'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ModelDetailDialog
        model={detailModel}
        open={detailModel !== null}
        onClose={() => setDetailModel(null)}
      />

      <ViewConfigDialog
        model={configModel}
        open={configModel !== null}
        onClose={() => setConfigModel(null)}
      />
    </>
  )
}
