'use client'

import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import type { Workspace as DashboardWorkspace } from '@/types/dashboard'
import { DashboardHeader } from './dashboard-header'
import { KpiCards } from './kpi-cards'
import { SecondaryStats } from './stats'
import { WorkspaceList } from './workspace-list'
import { ActiveAlerts } from './active-alert'

export function DashboardContent() {
  const { workspaces, loading } = useWorkspaces()

  const dashboardWorkspaces: DashboardWorkspace[] = workspaces.map(w => ({
    id: w.id,
    name: w.name,
    description: '',
    nodes: [],
    lastUpdated: 'N/A',
    modelsCount: w.modelsCount,
  }))

  const totalModels = workspaces.reduce((sum, w) => sum + w.modelsCount, 0)

  if (loading) return <div className="flex-1 p-6">Loading…</div>

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <DashboardHeader />
        <KpiCards
          totalWorkspaces={workspaces.length}
          totalNodes={0}
          machineCount={0}
          sensorCount={0}
          controllerCount={0}
          runningModels={0}
          totalModels={totalModels}
          warningModels={0}
          alertsCount={0}
        />
        <SecondaryStats
          machineCount={0}
          sensorCount={0}
          controllerCount={0}
          runningModels={0}
          warningModels={0}
          errorModels={0}
        />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <WorkspaceList workspaces={dashboardWorkspaces} />
          <ActiveAlerts alerts={[]} />
        </div>
      </div>
    </div>
  )
}
