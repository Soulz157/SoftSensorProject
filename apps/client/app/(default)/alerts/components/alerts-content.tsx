'use client'

import { useEffect, useState } from 'react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useAllModels } from '@/hooks/use-all-models'
import { failedDeploys } from '@/lib/model-status'
import { getNodes } from '@/services/canvas'
import type { CanvasNode } from '@/services/canvas'
import type { ModelLog } from '@/types'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  ArrowRight,
  CheckCircle2,
  Activity,
  Box,
  Cpu,
  Gauge,
  Thermometer,
  AlertTriangle,
  AlertCircle,
  Network,
  Power,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import AlertsLoading from '../loading'
import { Badge } from '@/components/ui/badge'
import { equipmentAlerts } from '@/lib/overview-status'
import {
  ALERT_STATUS_LABEL,
  ALERT_STATUS_PRIORITY,
  AlertClass,
  AlertNodeType,
  AlertStatus,
} from '@/lib/alerts'
interface AlertRow {
  id: string
  name: string
  kind: 'node' | 'model'
  type: AlertNodeType
  status: AlertStatus
  workspaceName: string
  href: string
  errorDetail?: string
  errorLogs?: ModelLog[]
  affectedNode?: {
    name: string
    planName: string | null
  }
}

function getTypeIcon(type: AlertNodeType) {
  switch (type) {
    case 'machine':
      return Cpu
    case 'sensor':
      return Thermometer
    case 'controller':
      return Gauge
    case 'model':
      return Box
    default:
      return Activity
  }
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

export function AlertsContent() {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { models, loading: modelsLoading } = useAllModels()
  const [nodesByWorkspace, setNodesByWorkspace] = useState<
    Record<string, CanvasNode[]>
  >({})

  useEffect(() => {
    if (workspacesLoading) return
    if (workspaces.length === 0) return

    let cancelled = false

    Promise.all(workspaces.map(w => getNodes(w.id)))
      .then(results => {
        if (cancelled) return
        const map: Record<string, CanvasNode[]> = {}
        workspaces.forEach((w, i) => {
          map[w.id] = results[i] ?? []
        })
        setNodesByWorkspace(map)
      })
      .catch(() => {
        if (!cancelled) setNodesByWorkspace({})
      })

    return () => {
      cancelled = true
    }
  }, [workspaces, workspacesLoading])

  if (workspacesLoading || modelsLoading) {
    return <AlertsLoading />
  }

  const alerts: AlertRow[] = []

  for (const workspace of workspaces) {
    const nodes = nodesByWorkspace[workspace.id] ?? []
    for (const node of nodes) {
      if (['alarm', 'offline', 'warning'].includes(node.data.status)) {
        alerts.push({
          id: node.id,
          name: node.data.name,
          kind: 'node',
          type: node.data.type,
          status: node.data.status as AlertStatus,
          workspaceName: workspace.name,
          href: `/plants/${workspace.id}?nodeId=${node.id}`,
        })
      }
    }
  }

  for (const model of failedDeploys(models ?? [])) {
    const errorLogs = (model.data?.logs ?? [])
      .filter(l => l.level === 'error')
      .slice(-3)

    const nodeData = model.nodes?.data as { name?: string } | undefined

    alerts.push({
      id: model.id,
      name: model.name,
      kind: 'model',
      type: 'model',
      status: 'failed',
      workspaceName: model.workspaceName,
      href: `/models/${model.id}`,
      errorDetail: model.data?.statusDetail,
      errorLogs: errorLogs.length > 0 ? errorLogs : undefined,
      affectedNode: model.nodes
        ? {
            name: nodeData?.name ?? 'Unknown Node',
            planName: model.nodes.plan?.name ?? null,
          }
        : undefined,
    })
  }

  alerts.sort(
    (a, b) =>
      (ALERT_STATUS_PRIORITY[a.status] ?? 99) -
      (ALERT_STATUS_PRIORITY[b.status] ?? 99),
  )

  const modelAlerts = alerts.filter(a => a.kind === 'model')
  const nodeAlerts = alerts.filter(a => a.kind === 'node')

  const alarmCount = alerts.filter(a => a.status === 'alarm').length
  const warningCount = alerts.filter(a => a.status === 'warning').length
  const offlineCount = alerts.filter(a => a.status === 'offline').length
  const failedCount = modelAlerts.length

  const defaultTab =
    equipmentAlerts.length > 0
      ? 'equipment'
      : modelAlerts.length > 0
        ? 'model-errors'
        : 'all'

  const nodeAlertsByWorkspace = nodeAlerts.reduce<Record<string, AlertRow[]>>(
    (acc, alert) => {
      const key = alert.workspaceName
      if (!acc[key]) acc[key] = []
      acc[key].push(alert)
      return acc
    },
    {},
  )

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link
                href="/overview"
                className="text-muted-foreground hover:text-foreground"
              >
                Overview
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>System Alerts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Alerts Overview
          </h1>
          {failedCount > 0 && (
            <Badge className="flex items-center rounded-full h-5 px-2 text-xs font-medium bg-red-500/10 text-red-600">
              {failedCount} Model Failed
            </Badge>
          )}
          {alarmCount > 0 && (
            <Badge className="flex items-center rounded-full h-5 px-2 text-xs font-medium bg-red-500/10 text-red-500">
              {alarmCount} Alarm
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge className="flex items-center rounded-full h-5 px-2 text-xs font-medium bg-amber-500/10 text-amber-500">
              {warningCount} Warning
            </Badge>
          )}
          {offlineCount > 0 && (
            <Badge className="flex items-center rounded-full h-5 px-2 text-xs font-medium bg-zinc-500/10 text-zinc-500">
              {offlineCount} Offline
            </Badge>
          )}
        </div>

        {alerts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {alarmCount > 0 && (
              <Card className="rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Alarms
                      </p>
                      <p className="text-2xl font-semibold text-red-500">
                        {alarmCount}
                      </p>
                    </div>
                    <div className="rounded-lg bg-red-500/10 p-2 text-red-500">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {failedCount > 0 && (
              <Card className="rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Deploy Failed
                      </p>
                      <p className="text-2xl font-semibold text-red-600">
                        {failedCount}
                      </p>
                    </div>
                    <div className="rounded-lg bg-red-500/10 p-2 text-red-600">
                      <Box className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {warningCount > 0 && (
              <Card className="rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Warnings
                      </p>
                      <p className="text-2xl font-semibold text-amber-500">
                        {warningCount}
                      </p>
                    </div>
                    <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {offlineCount > 0 && (
              <Card className="rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Offline
                      </p>
                      <p className="text-2xl font-semibold text-zinc-500">
                        {offlineCount}
                      </p>
                    </div>
                    <div className="rounded-lg bg-zinc-500/10 p-2 text-zinc-500">
                      <Power className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {alerts.length === 0 ? (
          <Card className="rounded-xl bg-card ring-1 ring-foreground/10 p-12 text-center shadow-none">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-foreground">
              No active alerts
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              All systems operating normally
            </p>
          </Card>
        ) : (
          <Tabs
            defaultValue={defaultTab}
            className="flex w-full flex-col space-y-4"
          >
            <TabsList className="flex h-auto w-full flex-row flex-wrap justify-start gap-2 bg-transparent p-0">
              <TabsTrigger
                value="equipment"
                className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-none"
              >
                <Network className="h-4 w-4" />
                Equipment Alerts
                {nodeAlerts.length > 0 && (
                  <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                    {nodeAlerts.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="model-errors"
                className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-none"
              >
                <Box className="h-4 w-4" />
                Model Errors
                {modelAlerts.length > 0 && (
                  <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                    {modelAlerts.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="all"
                className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-none"
              >
                All Events
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                  {alerts.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="model-errors"
              className="mt-2 space-y-4 outline-none"
            >
              {modelAlerts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground bg-muted/30 rounded-xl ring-1 ring-foreground/10">
                  No model deploy failures. Node alerts, if any, are isolated
                  hardware or sensor issues.
                </div>
              ) : (
                modelAlerts.map(modelAlert => {
                  const impactedNodes = nodeAlerts.filter(
                    n => n.workspaceName === modelAlert.workspaceName,
                  )

                  return (
                    <Card
                      key={modelAlert.id}
                      className="rounded-xl bg-card ring-1 ring-foreground/10 shadow-none overflow-hidden"
                    >
                      <CardHeader className="pb-4 bg-red-500/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-8 w-8 bg-red-500/10 rounded-lg shrink-0">
                              <Box className="h-4 w-4 text-red-600" />
                            </div>
                            <div>
                              <CardTitle className="text-base font-semibold text-red-600">
                                {modelAlert.name}
                              </CardTitle>
                              <p className="text-sm text-muted-foreground mt-0.5">
                                {ALERT_STATUS_LABEL[modelAlert.status]} ·{' '}
                                <strong className="font-semibold text-foreground">
                                  {modelAlert.workspaceName}
                                </strong>
                              </p>
                            </div>
                          </div>
                          <Link href={modelAlert.href}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2 rounded-lg ring-1 ring-foreground/10 shadow-none hover:bg-muted transition-none"
                            >
                              View Model <ArrowRight className="h-3 w-3" />
                            </Button>
                          </Link>
                        </div>
                      </CardHeader>

                      <div className="p-4 space-y-4 bg-muted/50 border-t border-foreground/10">
                        {modelAlert.errorDetail && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Error Detail
                            </p>
                            <div className="rounded-lg bg-destructive/5 p-3">
                              <p className="text-sm text-foreground">
                                {modelAlert.errorDetail}
                              </p>
                            </div>
                          </div>
                        )}

                        {modelAlert.errorLogs &&
                          modelAlert.errorLogs.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Recent Errors
                              </p>
                              <ul className="space-y-1.5">
                                {modelAlert.errorLogs.map((log, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-xs"
                                  >
                                    <span className="mt-1.25 h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                                    <span className="font-mono text-foreground flex-1 leading-relaxed">
                                      {log.message}
                                    </span>
                                    <span className="font-mono text-muted-foreground shrink-0 tabular-nums">
                                      {formatTimestamp(log.timestamp)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Location
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                              <Network className="h-3 w-3 text-muted-foreground" />
                              {modelAlert.workspaceName}
                            </span>
                            {modelAlert.affectedNode && (
                              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                                <Cpu className="h-3 w-3 text-muted-foreground" />
                                {modelAlert.affectedNode.name}
                                {modelAlert.affectedNode.planName && (
                                  <span className="text-muted-foreground">
                                    · {modelAlert.affectedNode.planName}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {impactedNodes.length > 0 && (
                        <div className="p-4 bg-muted/30 border-t border-foreground/10">
                          <p className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wider">
                            Impacted Equipment in {modelAlert.workspaceName}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {impactedNodes.map(node => {
                              const NodeIcon = getTypeIcon(node.type)
                              return (
                                <Link key={node.id} href={node.href}>
                                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-background ring-1 ring-foreground/5 hover:bg-muted/80 transition-none">
                                    <div className="flex items-center gap-2">
                                      <NodeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-sm font-medium">
                                        {node.name}
                                      </span>
                                    </div>
                                    <span
                                      className={cn(
                                        'flex items-center h-5 px-2 text-[10px] font-medium rounded-full',
                                        AlertClass[node.status],
                                      )}
                                    >
                                      {ALERT_STATUS_LABEL[node.status]}
                                    </span>
                                  </div>
                                </Link>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </Card>
                  )
                })
              )}
            </TabsContent>

            <TabsContent
              value="equipment"
              className="mt-2 space-y-5 outline-none"
            >
              {nodeAlerts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground bg-muted/30 rounded-xl ring-1 ring-foreground/10">
                  No equipment alerts.
                </div>
              ) : (
                Object.entries(nodeAlertsByWorkspace).map(
                  ([workspaceName, wsNodes]) => (
                    <div key={workspaceName} className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">
                        {workspaceName}
                      </p>
                      <Card className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-b border-foreground/10 hover:bg-transparent">
                              <TableHead>Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-12">Details</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {wsNodes.map(alert => {
                              const Icon = getTypeIcon(alert.type)
                              return (
                                <TableRow
                                  key={`node-${alert.id}`}
                                  className="border-b border-foreground/5 hover:bg-muted/50 transition-none"
                                >
                                  <TableCell className="font-semibold text-foreground">
                                    {alert.name}
                                  </TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                      <Icon className="h-3.5 w-3.5 shrink-0" />
                                      <span className="capitalize">
                                        {alert.type}
                                      </span>
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className={cn(
                                        'inline-flex items-center rounded-full h-5 px-2 text-xs font-medium',
                                        AlertClass[alert.status],
                                      )}
                                    >
                                      {alert.status === 'alarm' && (
                                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-red-500/40 animate-pulse" />
                                      )}
                                      {ALERT_STATUS_LABEL[alert.status]}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {alert.status === 'alarm' && (
                                      <span className="text-sm">
                                        Immediate attention required
                                      </span>
                                    )}
                                    {alert.status === 'offline' && (
                                      <span className="text-sm">
                                        Equipment is offline
                                      </span>
                                    )}
                                    {alert.status === 'warning' && (
                                      <span className="text-sm">
                                        Check equipment status
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Link href={alert.href}>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-lg hover:bg-muted"
                                      >
                                        <ArrowRight className="h-4 w-4" />
                                      </Button>
                                    </Link>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </Card>
                    </div>
                  ),
                )
              )}
            </TabsContent>

            <TabsContent value="all" className="mt-2 outline-none">
              <Card className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-none">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-foreground/10 hover:bg-transparent">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((alert, index) => {
                      const Icon = getTypeIcon(alert.type)
                      return (
                        <TableRow
                          key={`${alert.kind}-${alert.id}`}
                          className="border-b border-foreground/5 hover:bg-muted/50 transition-none"
                        >
                          <TableCell className="text-muted-foreground font-mono text-[13px]">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full h-5 px-2 text-xs font-medium',
                                AlertClass[alert.status],
                              )}
                            >
                              {alert.status === 'alarm' && (
                                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-red-500/40 animate-pulse" />
                              )}
                              {ALERT_STATUS_LABEL[alert.status]}
                            </span>
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {alert.name}
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="capitalize">{alert.type}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {alert.workspaceName}
                          </TableCell>
                          <TableCell>
                            <Link href={alert.href}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg hover:bg-muted"
                              >
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
