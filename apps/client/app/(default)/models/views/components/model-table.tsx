'use client'
import { useState } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  MoreHorizontal,
  Pencil,
  Power,
  RefreshCw,
  StopCircle,
  Terminal,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIModel } from '@/types'
import { Button } from '@/components/ui/button'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import Link from 'next/link'

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
    label: 'Error',
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
type PS = keyof typeof PROD_MAP

interface Props {
  models: AIModel[]
  loading: boolean
  isFetching: boolean
  onPreview: (m: AIModel) => void
  onEdit: (m: AIModel) => void
  onLog: (m: AIModel) => void
  onDelete: (m: AIModel) => void
}

export function ModelTable({
  models,
  loading,
  isFetching,
  onEdit,
  onLog,
  onDelete,
}: Props) {
  const [detailModel, setDetailModel] = useState<AIModel | null>(null)
  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Plant / Node</TableHead>
            <TableHead>DeploymentState</TableHead>
            <TableHead>OperationalState</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-36" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-7 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
        <Activity className="h-10 w-10 opacity-30" />
        <p className="text-base font-medium">No models yet</p>
        <p className="text-sm">Create a model and assign it to equipment.</p>
      </div>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Plant / Equipment</TableHead>
            <TableHead>Deploy</TableHead>
            <TableHead>Monitoring</TableHead>
            <TableHead className="w-36" />
          </TableRow>
        </TableHeader>
        <TableBody
          className={cn(
            'transition-opacity duration-200',
            isFetching && 'opacity-60',
          )}
        >
          {models.map(m => {
            const ds =
              DEPLOY_MAP[(m.data?.deployStatus ?? 'stopped') as DS] ??
              DEPLOY_MAP.stopped
            const ps =
              PROD_MAP[(m.data?.prodStatus ?? 'normal') as PS] ??
              PROD_MAP.normal
            const DIcon = ds.icon
            const PIcon = ps.icon
            const nodeName = m.nodes
              ? ((m.nodes.data as { name?: string }).name ?? '—')
              : '—'
            const plantName = m.nodes?.plan?.name ?? '—'
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
                  <p className="text-sm text-foreground">{plantName}</p>
                  <p className="text-xs text-muted-foreground">{nodeName}</p>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                      ds.cls,
                    )}
                  >
                    <DIcon className="h-3 w-3" />
                    {ds.label}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                      ps.cls,
                    )}
                  >
                    <PIcon className="h-3 w-3" />
                    {ps.label}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onLog(m)}
                      title="Console"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onEdit(m)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete &quot;{m.name}&quot;?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(m)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setDetailModel(m)}
                      title="Details"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ModelDetailDialog
        model={detailModel}
        open={detailModel !== null}
        onClose={() => setDetailModel(null)}
      />
    </>
  )
}
