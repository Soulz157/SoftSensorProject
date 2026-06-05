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

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'alarm':
    case 'offline':
      return 'bg-red-500/10 text-red-500'
    case 'warning':
      return 'bg-amber-500/10 text-amber-500'
    default:
      return 'bg-zinc-500/10 text-zinc-500'
  }
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
    if (workspaces.length === 0) {
      return
    }

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

  if (workspacesLoading) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Loading workspaces...</p>
      </div>
    )
  }

  if (nodesLoading) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Loading node data...</p>
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

  // Sort: alarm/offline first, then warning
  alerts.sort((a, b) => {
    const aIsHigh = isAlarmOrOffline(a.status)
    const bIsHigh = isAlarmOrOffline(b.status)
    if (aIsHigh && !bIsHigh) return -1
    if (!aIsHigh && bIsHigh) return 1
    return 0
  })

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Breadcrumb */}
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

        {/* Page title */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">System Alerts</h1>
          {alerts.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500"
            >
              {alerts.length}
            </Badge>
          )}
        </div>

        {/* Content */}
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
          <Card className="border-border bg-card">
            {/* Table header */}
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] items-center gap-4 border-b border-border px-4 py-3 text-xs font-medium text-muted-foreground">
              <span>#</span>
              <span>Status</span>
              <span>Node Name</span>
              <span>Type</span>
              <span>Workspace</span>
              <span>Action</span>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border">
              {alerts.map((alert, index) => {
                const Icon = getNodeTypeIcon(alert.nodeType)
                return (
                  <div
                    key={alert.nodeId}
                    className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="text-sm text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          getStatusBadgeClass(alert.status),
                        )}
                      >
                        {alert.status}
                      </span>
                    </span>
                    <span className="text-sm font-bold text-foreground">
                      {alert.nodeName}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      {alert.nodeType}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {alert.workspaceName}
                    </span>
                    <Link href={`/workspaces/${alert.workspaceId}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
