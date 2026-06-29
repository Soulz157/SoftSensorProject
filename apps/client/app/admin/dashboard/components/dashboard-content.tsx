'use client'

import { useEffect, useState } from 'react'
import type { Workspace as DashboardWorkspace, Alert } from '@/types/dashboard'
import { getNodes } from '@/services/canvas'
import type { CanvasNode } from '@/services/canvas'
import { DashboardHeader } from './dashboard-header'
import { KpiCards } from './kpi-cards'
import { WorkspaceList } from './workspace-list'
import { ActiveAlerts } from './active-alert'
import { Loader2 } from 'lucide-react'
import { useAdminAllWorkspaces } from '@/hooks/admin/use-admin-workspaces'

export function DashboardContent() {
  const { data: workspaces, loading: workspacesLoading } =
    useAdminAllWorkspaces()
  const [nodesByWorkspace, setNodesByWorkspace] = useState<Record<
    string,
    CanvasNode[]
  > | null>(null)

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

  const resolvedMap = nodesByWorkspace ?? {}
  const allNodes = Object.values(resolvedMap).flat()
  const activeNodes = allNodes.filter(n => n.data.status === 'normal').length
  const warningNodes = allNodes.filter(n => n.data.status === 'warning').length
  const errorNodes = allNodes.filter(
    n => n.data.status === 'alarm' || n.data.status === 'offline',
  ).length
  const totalNodes = allNodes.length
  const totalModels = workspaces.reduce(
    (sum, w) => sum + (w._count?.models ?? 0),
    0,
  )
  const alertsCount = warningNodes + errorNodes

  const alerts: Alert[] = []
  for (const workspace of workspaces) {
    const nodes = resolvedMap[workspace.id] ?? []
    for (const node of nodes) {
      if (node.data.status !== 'normal') {
        alerts.push({
          type: 'node',
          workspace: workspace.name,
          workspaceId: workspace.id,
          name: node.data.name,
          status: node.data.status,
          nodeType: node.data.type,
        })
      }
    }
  }

  const dashboardWorkspaces: DashboardWorkspace[] = workspaces.map(w => ({
    id: w.id,
    name: w.name,
    description: '',
    nodes: [],
    updatedAt: w.createdAt,
    modelsCount: w._count?.models ?? 0,
    color: w.color,
    icon: w.icon,
  }))

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <DashboardHeader />
        <KpiCards
          totalWorkspaces={workspaces.length}
          totalNodes={totalNodes}
          activeNodes={activeNodes}
          warningNodes={warningNodes}
          errorNodes={errorNodes}
          totalModels={totalModels}
          alertsCount={alertsCount}
        />
        <ActiveAlerts alerts={alerts} />

        <WorkspaceList
          workspaces={dashboardWorkspaces}
          nodesByWorkspace={resolvedMap}
        />
      </div>
    </div>
  )
}
