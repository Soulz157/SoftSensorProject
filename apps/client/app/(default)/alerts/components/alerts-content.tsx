'use client'

import { useEffect, useState } from 'react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { getNodes } from '@/services/canvas'
import type { CanvasNode } from '@/services/canvas'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  Cpu,
  Gauge,
  Thermometer,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NODE_STATUS_PRIORITY, NODE_DOT } from '@/constants/status'

interface AlertRow {
  nodeId: string
  nodeName: string
  nodeType: 'machine' | 'sensor' | 'controller'
  status: 'warning' | 'alarm' | 'offline'
  workspaceName: string
  workspaceId: string
}

function getNodeTypeIcon(type: 'machine' | 'sensor' | 'controller') {
  switch (type) {
    case 'machine':
      return Cpu
    case 'sensor':
      return Thermometer
    case 'controller':
      return Gauge
    default:
      return Activity
  }
}

const STATUS_CLASS: Record<string, string> = {
  alarm: 'bg-red-500/10 text-red-500',
  offline: 'bg-red-500/10 text-red-500',
  warning: 'bg-amber-500/10 text-amber-500',
}

function isAlarmOrOffline(status: string) {
  return status === 'alarm' || status === 'offline'
}

export function AlertsContent() {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
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

  const nodesLoading =
    !workspacesLoading && workspaces.length > 0 && nodesByWorkspace === null

  if (workspacesLoading || nodesLoading) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">
          {workspacesLoading ? 'Loading workspaces…' : 'Loading node data…'}
        </p>
      </div>
    )
  }

  const alerts: AlertRow[] = []
  for (const workspace of workspaces) {
    const nodes = nodesByWorkspace[workspace.id] ?? []
    for (const node of nodes) {
      if (
        node.data.status === 'alarm' ||
        node.data.status === 'offline' ||
        node.data.status === 'warning'
      ) {
        alerts.push({
          nodeId: node.id,
          nodeName: node.data.name,
          nodeType: node.data.type,
          status: node.data.status,
          workspaceName: workspace.name,
          workspaceId: workspace.id,
        })
      }
    }
  }

  alerts.sort(
    (a, b) =>
      (NODE_STATUS_PRIORITY[a.status] ?? 99) -
      (NODE_STATUS_PRIORITY[b.status] ?? 99),
  )

  const alarmCount = alerts.filter(a => a.status === 'alarm').length
  const warningCount = alerts.filter(a => a.status === 'warning').length
  const offlineCount = alerts.filter(a => a.status === 'offline').length

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground"
              >
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Alerts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            System Alerts
          </h1>
          {alarmCount > 0 && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-500">
              {alarmCount} alarm{alarmCount > 1 ? 's' : ''}
            </Badge>
          )}

          {warningCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500"
            >
              {warningCount} warning{warningCount > 1 ? 's' : ''}
            </Badge>
          )}

          {offlineCount > 0 && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-500">
              {offlineCount} offline
            </Badge>
          )}
        </div>

        {alerts.length === 0 ? (
          <Card className="border-border bg-card p-12 text-center">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-foreground">
              No active alerts
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              All systems operating normally
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Node Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert, index) => {
                  const Icon = getNodeTypeIcon(alert.nodeType)
                  return (
                    <TableRow key={alert.nodeId}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                            STATUS_CLASS[alert.status] ??
                              'bg-zinc-500/10 text-zinc-500',
                          )}
                        >
                          {alert.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {alert.nodeName}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="capitalize">{alert.nodeType}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {alert.workspaceName}
                      </TableCell>
                      <TableCell>
                        <Link href={`/workspaces/${alert.workspaceId}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
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
        )}
      </div>
    </div>
  )
}
