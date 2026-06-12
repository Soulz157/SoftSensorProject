import {
  Activity,
  AlertCircle,
  PauseCircle,
  RefreshCw,
  StopCircle,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'

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

type DS = keyof typeof DEPLOY_MAP

interface Props {
  models: ModelWithWorkspace[]
  loading: boolean
  isFetching: boolean
}

export function DeployedTable({ models, loading, isFetching }: Props) {
  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Workspace</TableHead>
            <TableHead>Plant / Equipment</TableHead>
            <TableHead>Status</TableHead>
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
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
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
        <PauseCircle className="h-10 w-10 opacity-30" />
        <p className="text-base font-medium">No models match the filter</p>
        <p className="text-sm">Try clearing the active filter.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>Workspace</TableHead>
          <TableHead>Plant / Equipment</TableHead>
          <TableHead>Deploy Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody
        className={cn(
          'transition-opacity duration-200',
          isFetching && 'opacity-60',
        )}
      >
        {models.map(m => {
          const deployKey = (m.data?.deployStatus ?? 'stopped') as DS
          const ds = DEPLOY_MAP[deployKey] ?? DEPLOY_MAP.stopped
          const DIcon = ds.icon
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
              <TableCell className="text-sm text-muted-foreground">
                {m.workspaceName}
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
                  <DIcon
                    className={cn(
                      'h-3 w-3',
                      deployKey === 'initializing' && 'animate-spin',
                    )}
                  />
                  {ds.label}
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
