'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Server,
  Network,
  HardDrive,
  Cpu,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import { cn } from '@/lib/utils'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

function WorkspaceIcon({
  iconId,
  colorId,
}: {
  iconId: string
  colorId: string
}) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon
  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white text-lg font-semibold shadow-sm ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-6 w-6" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

function StatusBadge({ status, text }: { status: string; text?: string }) {
  switch (status) {
    case 'normal':
    case 'healthy':
      return (
        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="truncate">{text || 'Normal'}</span>
        </div>
      )
    case 'warning':
      return (
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="truncate">{text || 'Warning'}</span>
        </div>
      )
    case 'alarm':
    case 'error':
      return (
        <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="truncate">{text || 'Error'}</span>
        </div>
      )
    default:
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          <span className="truncate">Unknown</span>
        </div>
      )
  }
}

export function WorkspaceCard({
  workspace,
  nodes = [],
}: {
  workspace: Workspace
  nodes?: CanvasNode[]
}) {
  const selectedColor = workspaceColors.find(
    item => item.id === workspace.color,
  )
  const accentClass = selectedColor?.bg || 'bg-blue-500'

  const devices = nodes.map(n => ({
    id: n.id,
    name: n.data?.name || `Device ${n.id.slice(0, 4)}`,
    status: n.data?.status || 'normal',
  }))

  const alarmCount = devices.filter(d => d.status === 'alarm').length
  const warnCount = devices.filter(d => d.status === 'warning').length
  const statusDot =
    alarmCount > 0
      ? 'bg-red-500'
      : warnCount > 0
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  const allModels = nodes.flatMap(
    n =>
      n.models?.map(m => {
        const rawData = m.data ?? {}
        return {
          id: m.id,
          name: m.name || `Model ${m.id.slice(0, 4)}`,
          status:
            typeof rawData.status === 'string' ? rawData.status : 'healthy',
          errorDetail:
            typeof rawData.errorDetail === 'string'
              ? rawData.errorDetail
              : undefined,
        }
      }) || [],
  )

  const sortedModels = [...allModels].sort((a, b) => {
    if (a.status === 'error') return -1
    if (b.status === 'error') return 1
    if (a.status === 'warning') return -1
    return 0
  })
  //Mockup
  const resourceMock = { cpu: 42, ram: 68 }

  return (
    <Card className="relative flex flex-col overflow-hidden border-border dark:bg-[#0f1115] transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
      <div className={cn('absolute left-0 top-0 h-1 w-full', accentClass)} />

      <CardContent className="flex flex-1 flex-col p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <WorkspaceIcon
            iconId={workspace.icon || 'box'}
            colorId={workspace.color || 'slate'}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">
                {workspace.name}
              </h3>
              <span className="flex h-6 items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-medium border border-border">
                <span className={cn('h-2 w-2 rounded-full', statusDot)} />
                {alarmCount > 0
                  ? 'Critical'
                  : warnCount > 0
                    ? 'Warning'
                    : 'Healthy'}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {workspace.modelsCount} AI model
              {workspace.modelsCount !== 1 ? 's' : ''} deployed
            </p>
          </div>
        </div>

        {/* Details Grid */}
        <div className="mb-6 grid grid-cols-2 gap-6">
          {/* Devices */}
          <div className="flex flex-col">
            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-2 text-sm font-medium text-foreground">
              <Server className="h-4 w-4 text-muted-foreground" />
              Devices ({devices.length})
            </div>
            <div className="space-y-2.5">
              {devices.slice(0, 3).map(device => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-xs text-muted-foreground">
                    {device.name}
                  </span>
                  <StatusBadge status={device.status} />
                </div>
              ))}
              {devices.length === 0 && (
                <span className="text-xs italic text-muted-foreground">
                  No devices found
                </span>
              )}
              {devices.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{devices.length - 3} more devices
                </span>
              )}
            </div>
          </div>

          {/* Models */}
          <div className="flex flex-col">
            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-2 text-sm font-medium text-foreground">
              <BrainCircuit className="h-4 w-4 text-muted-foreground" />
              Models ({allModels.length})
            </div>
            <div className="space-y-2.5">
              {sortedModels.slice(0, 3).map(model => (
                <div key={model.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {model.name}
                    </span>
                    <StatusBadge status={model.status} />
                  </div>
                  {model.status === 'error' && (
                    <span className="truncate text-[10px] text-red-500/80">
                      {model.errorDetail || 'Connection timeout'}
                    </span>
                  )}
                </div>
              ))}
              {allModels.length === 0 && (
                <span className="text-xs italic text-muted-foreground">
                  No models deployed
                </span>
              )}
              {allModels.length > 3 && (
                <span className="mt-1 text-xs text-muted-foreground">
                  +{allModels.length - 3} more models
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Resources - Mockup */}
        <div className="mb-6 rounded-lg bg-background/50 p-3 border border-border/50">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            System Resources Allocation
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="h-3 w-3" /> CPU
                </span>
                <span className="font-medium">{resourceMock.cpu}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Number(resourceMock.cpu)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <HardDrive className="h-3 w-3" /> Memory
                </span>
                <span className="font-medium">{resourceMock.ram}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${resourceMock.ram}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Updated{' '}
            {formatDistanceToNow(new Date(workspace.updatedAt), {
              addSuffix: true,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Link href={`/workspaces/${workspace.id}/details`}>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                View Details
              </Button>
            </Link>
            <Link href={`/workspaces/${workspace.id}/canvas`}>
              <Button
                size="sm"
                className="cursor-pointer h-8 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                <Network className="h-3.5 w-3.5" />
                Process Pipeline
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkspaceCardSkeleton() {
  return (
    <Card className="border-border bg-[#0f1115]">
      <CardContent className="flex flex-col p-6">
        <div className="mb-6 flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
