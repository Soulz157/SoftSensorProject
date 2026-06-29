'use client'

import { use, useState } from 'react'
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
  BrainCircuit,
  CheckCircle2,
  Clock,
  Map,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'
import { useWorkspaceLogs } from '@/hooks/workspace/use-workspace-logs'
import { useWorkspaceModels } from '@/hooks/workspace/use-workspace-models'
import { useWorkspaceNodes } from '@/hooks/workspace/use-workspace-nodes'
import { deriveStatus, equipmentAlerts } from '@/lib/overview-status'
import type { WorkspaceModel } from '@/types'
import { WorkspaceSettingsSheet } from '../components/workspace-settings-sheet'
import { EquipmentSection } from './components/equipment-section'
import { StatusAlertsSection } from './components/status-alerts-section'
import { ActivityLogSection } from './components/activity-log-section'
import {
  formatRelativeTime,
  statusColors,
  type ModelStatus,
} from './components/helpers'

function modelStatus(m: WorkspaceModel): ModelStatus {
  const raw = (m.data as { status?: string } | null)?.status
  if (raw === 'warning' || raw === 'error' || raw === 'stopped') return raw
  return 'active'
}

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const [settingsOpen, setSettingsOpen] = useState(false)

  const { workspace, loading: wsLoading } = useWorkspace(id)
  const { models, loading: modelsLoading } = useWorkspaceModels(id)
  const { logs, isFetching: logsLoading } = useWorkspaceLogs(id)
  const { nodes, loading: nodesLoading } = useWorkspaceNodes(id)

  const systemStatus = deriveStatus(nodes ?? [])
  const alertCount = equipmentAlerts(nodes ?? []).length
  const hasAlerts = systemStatus !== 'normal'
  const statusSc = statusColors(hasAlerts ? 'alarm' : 'normal')

  const updatedAt = workspace?.updatedAt
    ? formatRelativeTime(workspace.updatedAt)
    : '—'

  return (
    <>
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
              <Button
                variant="outline"
                className="cursor-pointer gap-2"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Button>
              <Link href={`/workspaces/${id}/canvas`}>
                <Button className="cursor-pointer gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
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
                    {nodesLoading ? (
                      <Skeleton className="h-9 w-24" />
                    ) : (
                      <p className={cn('text-3xl font-bold', statusSc.text)}>
                        {hasAlerts ? 'Abnormal' : 'Normal'}
                      </p>
                    )}
                  </div>
                  <div
                    className={cn('rounded-md p-2', statusSc.bg, statusSc.text)}
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
                    ? `${alertCount} equipment need attention`
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
            {/* Col 1 — Equipment in Workspace (real nodes from DB) */}
            <EquipmentSection
              nodes={nodes}
              loading={nodesLoading}
              workspaceId={id}
            />

            {/* Col 2 — AI Models (real data) */}
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

            {/* Col 3 — Status Alerts (equipment health) */}
            <StatusAlertsSection nodes={nodes} loading={nodesLoading} />
          </div>

          {/* Activity Log (all workspace events) */}
          <ActivityLogSection logs={logs} loading={logsLoading} />
        </div>
      </div>

      <WorkspaceSettingsSheet
        workspaceId={id}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}
