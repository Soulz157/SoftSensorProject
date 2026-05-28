'use client'

import { use, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  Map,
  Pencil,
  Settings,
  Thermometer,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/hooks/workspace/use-workspace'
import { useWorkspaceLogs } from '@/hooks/workspace/use-workspace-logs'
import { useWorkspaceModels } from '@/hooks/workspace/use-workspace-models'
import type { WorkspaceAction, WorkspaceLog, WorkspaceModel } from '@/types'

// ─── static placeholder nodes (no Node model in DB yet) ──────────────────────

const PLACEHOLDER_NODES = [
  {
    id: 'n1',
    name: 'CNC Machine A1',
    type: 'machine' as const,
    status: 'normal' as const,
  },
  {
    id: 'n2',
    name: 'Assembly Robot B2',
    type: 'machine' as const,
    status: 'normal' as const,
  },
  {
    id: 'n3',
    name: 'Conveyor System C1',
    type: 'machine' as const,
    status: 'warning' as const,
  },
  {
    id: 'n4',
    name: 'Temperature Sensor T1',
    type: 'sensor' as const,
    status: 'normal' as const,
  },
  {
    id: 'n5',
    name: 'Main Controller',
    type: 'controller' as const,
    status: 'normal' as const,
  },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

type NodeType = 'machine' | 'sensor' | 'controller'
type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'
type ModelStatus = 'active' | 'warning' | 'error' | 'stopped'

function getNodeIcon(type: NodeType) {
  switch (type) {
    case 'machine':
      return <Cpu className="h-4 w-4" />
    case 'sensor':
      return <Thermometer className="h-4 w-4" />
    case 'controller':
      return <Gauge className="h-4 w-4" />
  }
}

function statusColors(status: NodeStatus | ModelStatus) {
  switch (status) {
    case 'normal':
    case 'active':
      return {
        text: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        dot: 'bg-emerald-500',
      }
    case 'warning':
      return {
        text: 'text-amber-500',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-500',
      }
    case 'alarm':
    case 'error':
      return { text: 'text-red-500', bg: 'bg-red-500/10', dot: 'bg-red-500' }
    default:
      return { text: 'text-zinc-400', bg: 'bg-zinc-500/10', dot: 'bg-zinc-400' }
  }
}

function modelStatus(m: WorkspaceModel): ModelStatus {
  const raw = (m.data as { status?: string } | null)?.status
  if (raw === 'warning' || raw === 'error' || raw === 'stopped') return raw
  return 'active'
}

// Alert-level actions
const ALERT_ACTIONS: WorkspaceAction[] = [
  'DELETED',
  'MODEL_REMOVED',
  'MODEL_UPDATED',
  'UPDATED',
]
const DANGER_ACTIONS: WorkspaceAction[] = ['DELETED', 'MODEL_REMOVED']

function alertSeverity(action: WorkspaceAction): 'danger' | 'warning' {
  return DANGER_ACTIONS.includes(action) ? 'danger' : 'warning'
}

function alertLabel(action: WorkspaceAction): string {
  switch (action) {
    case 'DELETED':
      return 'Workspace deleted'
    case 'MODEL_REMOVED':
      return 'Model removed'
    case 'MODEL_UPDATED':
      return 'Model updated'
    case 'UPDATED':
      return 'Workspace updated'
    default:
      return action
  }
}

function AlertIcon({ action }: { action: WorkspaceAction }) {
  const severity = alertSeverity(action)
  const cls =
    severity === 'danger'
      ? 'bg-red-500/10 text-red-500'
      : 'bg-amber-500/10 text-amber-500'
  const Icon =
    action === 'DELETED'
      ? Trash2
      : action === 'MODEL_UPDATED'
        ? Pencil
        : AlertTriangle
  return (
    <div className={cn('rounded-md p-2', cls)}>
      <Icon className="h-4 w-4" />
    </div>
  )
}

function actorName(log: WorkspaceLog): string {
  const { firstName, lastName, email } = log.user
  if (firstName || lastName)
    return `${firstName ?? ''} ${lastName ?? ''}`.trim()
  return email
}

// ─── component ───────────────────────────────────────────────────────────────

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const { workspace, loading: wsLoading } = useWorkspace(id)
  const { models, loading: modelsLoading } = useWorkspaceModels(id)
  const { logs, loading: logsLoading } = useWorkspaceLogs(id)

  // Derive alert logs from workspace log feed
  const alertLogs = useMemo(
    () =>
      (logs ?? []).filter(l => ALERT_ACTIONS.includes(l.action)).slice(0, 8),
    [logs],
  )

  const hasAlerts = alertLogs.length > 0

  const updatedAt = workspace?.updatedAt
    ? formatRelativeTime(workspace.updatedAt)
    : '—'

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/workspaces">Workspaces</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {wsLoading ? (
                  <Skeleton className="inline-block h-4 w-32" />
                ) : (
                  (workspace?.name ?? 'Workspace')
                )}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            {wsLoading ? (
              <>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="mt-2 h-4 w-40" />
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  {workspace?.name ?? 'Workspace'}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Created{' '}
                  {workspace?.createdAt
                    ? formatRelativeTime(workspace.createdAt)
                    : '—'}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </Button>
            <Link href={`/workspaces/${id}/canvas`}>
              <Button className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
                <Map className="h-4 w-4" />
                Open Canvas
              </Button>
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* AI Models */}
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    AI Models
                  </p>
                  {wsLoading ? (
                    <Skeleton className="h-9 w-12" />
                  ) : (
                    <p className="text-3xl font-bold text-foreground">
                      {workspace?._count.models ?? 0}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <BrainCircuit className="h-5 w-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Deployed models</p>
            </CardContent>
          </Card>

          {/* System Status */}
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    System Status
                  </p>
                  {logsLoading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    <p
                      className={cn(
                        'text-3xl font-bold',
                        hasAlerts ? 'text-amber-500' : 'text-emerald-500',
                      )}
                    >
                      {hasAlerts ? 'Warning' : 'Normal'}
                    </p>
                  )}
                </div>
                <div
                  className={cn(
                    'rounded-md p-2',
                    hasAlerts
                      ? 'bg-amber-500/10 text-amber-500'
                      : 'bg-emerald-500/10 text-emerald-500',
                  )}
                >
                  {hasAlerts ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {hasAlerts
                  ? `${alertLogs.length} recent alerts`
                  : 'All systems operational'}
              </p>
            </CardContent>
          </Card>

          {/* Activity */}
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Activity
                  </p>
                  {logsLoading ? (
                    <Skeleton className="h-9 w-12" />
                  ) : (
                    <p className="text-3xl font-bold text-foreground">
                      {logs?.length ?? 0}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Activity className="h-5 w-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Recent workspace events
              </p>
            </CardContent>
          </Card>

          {/* Last Updated */}
          <Card className="border-border bg-card">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Last Updated
                  </p>
                  {wsLoading ? (
                    <Skeleton className="h-9 w-24" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">
                      {updatedAt}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-muted p-2 text-muted-foreground">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Last workspace change
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 3-column layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Col 1 — Nodes in Canvas (placeholder until Node model added) */}
          <div className="space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Cpu className="h-5 w-5 text-primary" />
                Nodes in Canvas
              </h2>
              <Link href={`/workspaces/${id}/canvas`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-primary"
                >
                  View All
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
            <Card className="border-border bg-card">
              <div className="divide-y divide-border">
                {PLACEHOLDER_NODES.map(node => {
                  const sc = statusColors(node.status)
                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn('rounded-md p-2', sc.bg, sc.text)}>
                          {getNodeIcon(node.type)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {node.name}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="text-xs capitalize text-muted-foreground">
                              {node.type}
                            </span>
                            <span
                              className={cn('h-1.5 w-1.5 rounded-full', sc.dot)}
                            />
                            <span
                              className={cn(
                                'text-xs font-medium capitalize',
                                sc.text,
                              )}
                            >
                              {node.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-border bg-muted/20 p-3">
                <Link href={`/workspaces/${id}/canvas`} className="block">
                  <Button
                    variant="ghost"
                    className="h-8 w-full gap-2 text-xs text-muted-foreground"
                  >
                    <Map className="h-4 w-4" />
                    Open Canvas Map
                  </Button>
                </Link>
              </div>
            </Card>
          </div>

          {/* Col 2 — Models & Status (real data) */}
          <div className="space-y-4 lg:col-span-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <BrainCircuit className="h-5 w-5 text-primary" />
              AI Models
            </h2>
            <Card className="border-border bg-card">
              {modelsLoading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-4">
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : models && models.length > 0 ? (
                <div className="max-h-96 divide-y divide-border overflow-y-auto">
                  {models.map(model => {
                    const status = modelStatus(model)
                    const sc = statusColors(status)
                    return (
                      <div
                        key={model.id}
                        className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p
                            className="max-w-40 truncate text-sm font-medium text-foreground"
                            title={model.name}
                          >
                            {model.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Updated {formatRelativeTime(model.updatedAt)}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'ml-2 shrink-0 gap-1 text-[10px] capitalize',
                            sc.bg,
                            sc.text,
                          )}
                        >
                          <span
                            className={cn('h-1.5 w-1.5 rounded-full', sc.dot)}
                          />
                          {status}
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
                  <BrainCircuit className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No models yet</p>
                  <p className="text-xs">
                    Add models via the canvas to see them here.
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* Col 3 — Status Alerts (from WorkspaceLog) */}
          <div className="space-y-4 lg:col-span-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Status Alerts
            </h2>
            <Card className="border-border bg-card">
              {logsLoading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-4">
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : alertLogs.length > 0 ? (
                <div className="divide-y divide-border">
                  {alertLogs.map(log => (
                    <div
                      key={log.id}
                      className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
                    >
                      <AlertIcon action={log.action} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {alertLabel(log.action)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {actorName(log)} · {formatRelativeTime(log.createdAt)}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm">No alerts</p>
                  <p className="text-xs">All systems operating normally.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
